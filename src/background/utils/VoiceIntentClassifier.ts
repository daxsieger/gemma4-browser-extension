import type FeatureExtractor from "./FeatureExtractor.ts";

const STRONG_STOP_PATTERN =
  /\b(ciao|arrivederci|alla prossima|a presto|buonanotte|grazie(?: mille)?|ti ringrazio|ok grazie|perfetto grazie|basta cosi|basta così|non serve altro|non mi serve altro|ho finito|abbiamo finito|puoi fermarti|fermati pure|smetti di ascoltare|chiudiamo qui)\b/;
const STRONG_CONTINUE_PATTERN =
  /\b(ma|però|pero|adesso|continua|continuiamo|aspetta|anzi|un'altra domanda|un altro dubbio|ti chiedo anche|mi serve ancora|puoi anche|fammi anche|spiegami meglio|correggi|riformula)\b/;

const STOP_EXAMPLES = [
  "ok grazie, basta cosi puoi smettere di ascoltare",
  "ciao alla prossima, abbiamo finito",
  "grazie mille, non mi serve altro",
  "perfetto, puoi fermarti qui",
  "va bene cosi, ho finito grazie",
  "chiudiamo qui, grazie",
];

const CONTINUE_EXAMPLES = [
  "grazie, ma adesso fammi anche un esempio",
  "ok continua, ho un'altra domanda",
  "grazie, puoi spiegarmi meglio questo punto",
  "aspetta, correggi la risposta precedente",
  "perfetto, adesso dimmi anche come testarlo",
  "grazie, ma non fermarti devo ancora chiederti una cosa",
];

interface ClassifyVoiceIntentParams {
  prompt: string;
  assistantContext?: string;
}

interface VoiceIntentClassification {
  shouldStopListening: boolean;
  stopSimilarity: number;
  continueSimilarity: number;
}

export default class VoiceIntentClassifier {
  private featureExtractor: FeatureExtractor;
  private stopVectorsPromise: Promise<Array<number[]>> | null = null;
  private continueVectorsPromise: Promise<Array<number[]>> | null = null;

  constructor(featureExtractor: FeatureExtractor) {
    this.featureExtractor = featureExtractor;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let index = 0; index < a.length; index += 1) {
      dotProduct += a[index] * b[index];
      magnitudeA += a[index] * a[index];
      magnitudeB += b[index] * b[index];
    }

    const magnitude = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  private async getStopVectors() {
    if (!this.stopVectorsPromise) {
      this.stopVectorsPromise = this.featureExtractor.extractFeatures(STOP_EXAMPLES);
    }

    return this.stopVectorsPromise;
  }

  private async getContinueVectors() {
    if (!this.continueVectorsPromise) {
      this.continueVectorsPromise = this.featureExtractor.extractFeatures(
        CONTINUE_EXAMPLES
      );
    }

    return this.continueVectorsPromise;
  }

  public async classify({
    prompt,
    assistantContext = "",
  }: ClassifyVoiceIntentParams): Promise<VoiceIntentClassification> {
    const normalizedPrompt = prompt.trim().toLowerCase();

    if (!normalizedPrompt) {
      return {
        shouldStopListening: false,
        stopSimilarity: 0,
        continueSimilarity: 0,
      };
    }

    if (STRONG_CONTINUE_PATTERN.test(normalizedPrompt)) {
      return {
        shouldStopListening: false,
        stopSimilarity: 0,
        continueSimilarity: 1,
      };
    }

    if (
      STRONG_STOP_PATTERN.test(normalizedPrompt) &&
      !STRONG_CONTINUE_PATTERN.test(normalizedPrompt)
    ) {
      return {
        shouldStopListening: true,
        stopSimilarity: 1,
        continueSimilarity: 0,
      };
    }

    const query = [
      `User prompt: ${normalizedPrompt}`,
      assistantContext.trim() ? `Recent assistant context: ${assistantContext.trim()}` : "",
      "Classify whether the user wants to end the voice conversation or continue it.",
    ]
      .filter(Boolean)
      .join("\n");

    const [queryVector, stopVectors, continueVectors] = await Promise.all([
      this.featureExtractor.extractFeatures([query]).then((result) => result[0]),
      this.getStopVectors(),
      this.getContinueVectors(),
    ]);

    const stopSimilarity = Math.max(
      ...stopVectors.map((vector) => this.cosineSimilarity(queryVector, vector))
    );
    const continueSimilarity = Math.max(
      ...continueVectors.map((vector) =>
        this.cosineSimilarity(queryVector, vector)
      )
    );

    return {
      shouldStopListening:
        stopSimilarity >= 0.62 && stopSimilarity > continueSimilarity + 0.06,
      stopSimilarity,
      continueSimilarity,
    };
  }
}