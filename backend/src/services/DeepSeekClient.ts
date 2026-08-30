import { DEEPSEEK_API_KEY, ROUTE_RECOMMENDATION } from '../config';
import { logger } from '../utils/logger';

export interface AiRanking { placeId: string; reason: string; aiRank: number; classification?: 'recommended' | 'good_alternative' | 'emergency_option' }

export class DeepSeekClient {
  constructor(private readonly apiKey = DEEPSEEK_API_KEY, private readonly fetcher = globalThis.fetch) {}

  async rank(category: string, routeDistanceMeters: number, candidates: Array<Record<string, unknown>>): Promise<AiRanking[] | null> {
    if (!this.apiKey || !candidates.length) return null;
    const allowedIds = new Set(candidates.map(candidate => String(candidate.placeId)));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ROUTE_RECOMMENDATION.deepSeekTimeoutMs);
    const startedAt = Date.now();
    try {
      const response = await this.fetcher('https://api.deepseek.com/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'deepseek-v4-flash', thinking: { type: 'disabled' }, temperature: 0, max_tokens: 450,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Rank only supplied real places. Never introduce IDs or facts. Return JSON {"recommendations":[{"placeId":"...","reason":"one short, calm, rider-friendly sentence","aiRank":1,"classification":"recommended|good_alternative|emergency_option"}]}. Do not issue navigation or urgent riding instructions.' },
            { role: 'user', content: JSON.stringify({ trip: { approximateRouteLengthMeters: Math.round(routeDistanceMeters), category }, candidates }) },
          ],
        }),
      });
      if (!response.ok) throw new Error(`DeepSeek status ${response.status}`);
      const payload = await response.json() as any;
      const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
      const rankings = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
      const unsafeInstruction = /\b(turn around|u-turn|immediately|speed up|slow down|stop now|stop immediately|ride faster|accelerate)\b/i;
      const valid = rankings.filter((item: any) => allowedIds.has(item?.placeId) && typeof item?.reason === 'string' && item.reason.trim().length > 0 && item.reason.length <= 220 && !unsafeInstruction.test(item.reason) && Number.isInteger(item?.aiRank) && item.aiRank > 0)
        .map((item: any) => ({ placeId: item.placeId, reason: item.reason.trim(), aiRank: item.aiRank, classification: ['recommended', 'good_alternative', 'emergency_option'].includes(item.classification) ? item.classification : undefined }));
      logger.info('route recommendation AI completed', { success: true, latencyMs: Date.now() - startedAt, inputTokenCount: payload.usage?.prompt_tokens, outputTokenCount: payload.usage?.completion_tokens });
      return valid;
    } catch {
      logger.warn('route recommendation AI unavailable', { success: false, latencyMs: Date.now() - startedAt });
      return null;
    } finally { clearTimeout(timeout); }
  }
}
