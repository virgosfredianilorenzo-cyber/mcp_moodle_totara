import axios, { AxiosInstance, AxiosError } from "axios";
import NodeCache from "node-cache";
import qs from "qs";

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
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
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
      const response = await this.client.post(
        "",
        qs.stringify({ ...params, wsfunction: functionName })
      );
      const data = response.data as any;
      if (data && typeof data === "object" && !Array.isArray(data) && data.exception) {
        throw new Error(`Moodle API Error: ${data.message} (${data.errorcode})`);
      }
      this.cache.set(cacheKey, data);
      return data as T;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const moodleError = error.response?.data;
        if (moodleError?.error) {
          throw new Error(`Moodle API Error: ${moodleError.error} (${moodleError.errorcode})`);
        }
        throw new Error(`Moodle API Request Failed: ${error.message}`);
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Unknown error: ${String(error)}`);
    }
  }
}
