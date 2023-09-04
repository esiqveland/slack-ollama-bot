import { clearTimeout } from "timers";
import { App } from "@slack/bolt";
import { ChatPostMessageResponse } from "@slack/web-api";
import OllamaService from './ollama/ollama'

const SLACK_APP_TOKEN = getEnv('SLACK_APP_TOKEN');
const SLACK_BOT_TOKEN = getEnv('SLACK_BOT_TOKEN');
const SIGNING_SECRET = getEnv('SLACK_SIGNING_SECRET');
const OLLAMA_URL = getEnv('OLLAMA_URL', 'http://127.0.0.1:11434');

const OLLAMA_MODEL_NAME = process.env.OLLAMA_MODEL_NAME || 'codemonkey';

const ollama = new OllamaService(new URL(OLLAMA_URL), OLLAMA_MODEL_NAME);

const app = new App({
    appToken: SLACK_APP_TOKEN,
    token: SLACK_BOT_TOKEN,
    signingSecret: SIGNING_SECRET,
    socketMode: true,
});

interface Task {
    id: string
    cleanText: string
    text: string
    channel: string
}
const IN_FLIGHT = new Map<string, Task>();
const STOP_BOT_TIMEOUT = 'STOP_BOT_TIMEOUT';
const SLACK_MAX_MSG_LEN = 3800;
let count = 0;

// Sending 'Bot is typing...' notification is not possible in Slack bots, but we could replace message response
// using chat.update API after chat.postMessage.
// See: https://github.com/slackapi/bolt-js/issues/885#issuecomment-1383319756
app.event('app_mention', async (input) => {
    const { event, context, client, say } = input;
    const chan = event.channel;
    const text = event.text;
    const botUserId = context.botUserId;

    const cleanText = text
        .trim()
        .replace(`<@${botUserId}>`, '')
        .replace(`@${botUserId}`, '')
        .replace(`${botUserId}`, '')
        .trim();

    log(`received cleanText: ${ cleanText } text: ${ text } evt=${ JSON.stringify(event) }`);
    if (cleanText && cleanText.length < 3) {
        log(`received text is too short: ${ text } evt=${ JSON.stringify(event) }`)
        return
    }

    if (IN_FLIGHT.size > 0) {
        const first = IN_FLIGHT.values().next().value;

        await say({
            text: `Sorry, I am already working on '${ first.cleanText }'.`,
            channel: chan,
            mrkdwn: true,
        })
        return;
    }

    count = count + 1;
    const task: Task = {
        id: `${count}`,
        channel: chan,
        cleanText: cleanText,
        text: text,
    };
    const abortController = new AbortController();
    const timer = setTimeout(() => {
        log(`task[${task.id}]: timeout reached, abort request.`)
        abortController.abort(STOP_BOT_TIMEOUT)
    }, 60 * 1000);
    try {
        IN_FLIGHT.set(task.id, task);

        let myChatResponse: ChatPostMessageResponse = await say({
            channel: chan,
            text: 'Let me think about that...',
            mrkdwn: true,
        });

        let parts: string[] = []
        let msgText = '';
        const lineHandler = async (line: string) => {
            if (msgText.length >= SLACK_MAX_MSG_LEN) {
                parts.push(msgText);
                msgText = line;

                myChatResponse = await say({
                    channel: chan,
                    text: msgText,
                    mrkdwn: true,
                });
            } else {
                msgText = msgText + line;
                await client.chat.update({
                    text: msgText,
                    channel: chan,
                    ts: myChatResponse.ts!,
                    mrkdwn: true,
                })
            }
        }
        const resp = await ollama.generateStream({
            userInput: cleanText,
            abortSignal: abortController.signal,
            lineHandler: lineHandler,
        });
        log(`resp=${ JSON.stringify(resp) }`)
        if (timer) {
            clearTimeout(timer);
        }

        await say({
            text: `I spent ${ resp.final.eval_duration / 100_000_000 }s processing that, producing ${ resp.final.eval_count / (resp.final.eval_duration / 100_000_000) } tokens/sec!`,
            channel: chan,
            mrkdwn: true,
        })
    } catch (err) {
        console.error(err);
        abortController.abort('error: ' + err);
    } finally {
        IN_FLIGHT.delete(task.id);
        if (timer) {
            clearTimeout(timer);
        }
    }
})

export default app;

function getEnv(envName: string, defaultValue?: string): string {
    const val = process.env[envName];
    if (!val || val === '') {
        if (defaultValue) {
            return defaultValue;
        } else {
            throw new Error('missing ENV variable: ' + envName);
        }
    }
    return val;
}

function log(...args: any) {
    console.log(...args);
}

