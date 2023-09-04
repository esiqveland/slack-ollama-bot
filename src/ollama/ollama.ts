
type GenerateRequest = {
    // model: (required) the model name
    model: string | undefined,
    // the prompt to generate a response for
    prompt: string,
    // system prompt to (overrides what is defined in the Modelfile as the SYSTEM prompt)
    system: string | undefined
    // the context parameter returned from a previous request to /generate, this can be used to keep a short conversational memory
    context: [number] | undefined,
}

type GenerateResponse = GeneratePartialResponse | GenerateFinalResponse

// GenerateResponse is a stream of JSON objects:
interface GeneratePartialResponse {
    "model": string // "llama2:7b",
    "created_at": string // "2023-08-04T08:52:19.385406455-07:00",
    "response": string // "The", a token from the response being built
    "done": boolean // is this the last of the stream?
}

// To calculate how fast the response is generated in tokens per second (token/s), divide eval_count / eval_duration.
// {
//   "model": "llama2:7b",
//   "created_at": "2023-08-04T19:22:45.499127Z",
//   "context": [1, 2, 3],
//   "done": true,
//   "total_duration": 5589157167,
//   "load_duration": 3013701500,
//   "sample_count": 114,
//   "sample_duration": 81442000,
//   "prompt_eval_count": 46,
//   "prompt_eval_duration": 1160282000,
//   "eval_count": 113,
//   "eval_duration": 1325948000
// }
interface GenerateFinalResponse extends GeneratePartialResponse {
    done: true,
    context: [number],
    total_duration: number,
    load_duration: number,
    sample_count: number,
    sample_duration: number,
    prompt_eval_count: number,
    prompt_eval_duration: number,
    eval_count: number,
    eval_duration: number,
}

export interface GenerateResult {
    answer: string
    final: GenerateFinalResponse
}

export default class OllamaService {
    private readonly _modelName: string;
    private readonly _baseUrl: URL;

    constructor(baseUrl: URL, modelName: string) {
        this._baseUrl = baseUrl;
        this._modelName = modelName;
    }

    public async generateStream({
        userInput,
        context,
        abortSignal,
        lineHandler,
    } : {
        userInput: string,
        context?: ArrayLike<number>,
        abortSignal?: AbortSignal,
        lineHandler: (s: string) => Promise<void>,
    }) : Promise<GenerateResult> {
        const url = this.getUrl('/api/generate')

        // @ts-ignore
        const postResponse = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this._modelName,
                prompt: userInput,
                context: context,
            }),
            signal: abortSignal,
        });
        if (!postResponse.ok) {
            throw new Error(`error: calling url=${url.toString()} status=${ postResponse.status }`);
        }

        const responses: Array<GenerateResponse> = [];
        let textLine = '';

        await readResponseStream(postResponse, async (res) => {
            responses.push(res);
            textLine = textLine + (res.response || '');
            if (textLine.length > 500) {
                const packet = textLine;
                textLine = '';
                //console.log('packet=' + packet);
                await lineHandler(packet);
            }
        })
        // flush the final line:
        if (textLine !== '') {
            await lineHandler(textLine);
            textLine = '';
        }

        const finalResponse = responses[responses.length - 1] as GenerateFinalResponse;
        const responseText = responses.map(e => e.response).filter(e => e != null).join("").trim();

        return {
            answer: responseText,
            final: finalResponse,
        }
    }

    public async generate({ userInput, context } : { userInput: string, context?: ArrayLike<number> }) : Promise<GenerateResult> {
        const url = this.getUrl('/api/generate')

        // @ts-ignore
        const postResponse = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this._modelName,
                prompt: userInput,
                context: context,
            }),
            //signal: abortSignal,
        });
        if (!postResponse.ok) {
            throw new Error(`error: calling url=${url.toString()} status=${ postResponse.status }`);
        }

        const res = await postResponse.text();
        // res is a newline delmitited JSON streaming response...
        const response: Array<GeneratePartialResponse> = res.split("\n").filter((e?: string) => !!e).map((e: string) => {
            //console.log('val: ' + e);
            return JSON.parse(e) as GeneratePartialResponse
        })

        const finalResponse = response[response.length - 1] as GenerateFinalResponse;
        const responseText = response.map(e => e.response).filter(e => e != null).join("").trim();

        return {
            answer: responseText,
            final: finalResponse,
        }
    }

    private getUrl(path: string): URL {
        const url = new URL(this._baseUrl.toString())
        url.pathname = path;
        return url
    }
}

// Function to stream the response from the server
// @ts-ignore
async function readResponseStream(response: Response, callback: (s: GenerateResponse) => Promise<void>) {
    const reader = response.body.getReader();
    let partialLine = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        // Decode the received value and split by lines
        const textChunk = new TextDecoder().decode(value);
        const lines = (partialLine + textChunk).split('\n');
        partialLine = lines.pop() || ''; // The last line might be incomplete

        for (const line of lines) {
            if (line.trim() === '') continue;
            const parsedResponse = tryParse(line);
            await callback(parsedResponse); // Process each response word
        }
    }

    // Handle any remaining line
    if (partialLine.trim() !== '') {
        const parsedResponse = JSON.parse(partialLine);
        await callback(parsedResponse);
    }
}

function tryParse(str: string): GenerateResponse {
    try {
        return JSON.parse(str) as GenerateResponse
    } catch (err) {
        console.error(`error parsing line='${ str }'`);
        throw err;
    }
}
