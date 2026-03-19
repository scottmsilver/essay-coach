import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { GoogleGenAI } from '@google/genai';
import { isEmailAllowed } from './allowlist';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

/**
 * Suggest a short essay title based on the assignment prompt.
 * Uses a fast model (Gemini Flash) for low latency.
 */
export const suggestTitle = onCall(
  { timeoutSeconds: 30, secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const email = request.auth.token.email;
    if (!email || !(await isEmailAllowed(email))) {
      throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
    }

    const { prompt } = request.data;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
      return { title: '' };
    }

    const ai = new GoogleGenAI({ apiKey: geminiApiKey.value() });
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt.trim(),
      config: {
        systemInstruction: 'Generate a short, descriptive essay title (3-8 words) based on this assignment prompt. Return only the title, no quotes or explanation.',
        temperature: 0.7,
        maxOutputTokens: 30,
      },
    });

    const title = response.text?.trim().replace(/^["']|["']$/g, '') ?? '';
    return { title };
  }
);
