import { describe, expect, it } from 'vitest';
import OllamaService from "./ollama";

const testUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const modelName = process.env.OLLAMA_MODEL_NAME || 'wolf';

const ollama = new OllamaService(new URL(testUrl), modelName);

describe('ollama', () => {
    it('should generate some answer', async () => {
        const res = await ollama.generate({ userInput: 'Hello' });
        expect(res.answer).toBe('fdsafdsa');
    }, { timeout: 30 * 1000 });

    it('should stream some answer', async () => {

        const res = await ollama.generateStream({
            userInput: 'Hello',
            lineHandler: str => {

            },
        });
        expect(res.answer).toBe('fdsafdsa');
    }, { timeout: 30 * 1000 });
});