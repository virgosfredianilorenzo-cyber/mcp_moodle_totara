import axios, { AxiosInstance, AxiosError } from "axios";
import NodeCache from "node-cache";

export class MoodleClient {
  private client: AxiosInstance;
  private cache: NodeCache;

  constructor(baseUrl: string, token: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      params: {
        wstoken: token,
        moodlewsrestformat: "json",
      },
    });
    this.cache = new NodeCache({ stdTTL: 60 }); // Cache valide 60 secondes
  }

  async callFunction<T = any>(functionName: string, params: Record<string, any> = {}): Promise<T> {
    const cacheKey = `${functionName}_${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached as T;
    }

    try {
      const response = await this.client.post("", {
        ...params,
        wsfunction: functionName,
      });
      this.cache.set(cacheKey, response.data);
      return response.data as T;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const moodleError = error.response?.data;
        if (moodleError?.error) {
          throw new Error(`Moodle API Error: ${moodleError.error} (${moodleError.errorcode})`);
        }
        throw new Error(`Moodle API Request Failed: ${error.message}`);
      }
      throw new Error(`Unknown error: ${String(error)}`);
    }
  }
}
