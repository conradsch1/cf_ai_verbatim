import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_SM2_STATE,
  type SM2State,
  calculateNextReview,
  type QualityScore,
} from "./sm2";

/**
 * Per-session coordination and SM-2 state (stub).
 * Full persistence and routing will use storage + HTTP shape in later tasks.
 */
export class MemorizationSession extends DurableObject {
  /** Stub: in-memory SM-2 snapshot for development. */
  private sm2State: SM2State = { ...DEFAULT_SM2_STATE };

  /** Exposed for tests / future routes — not persisted yet. */
  getSm2State(): SM2State {
    return { ...this.sm2State };
  }

  /** Applies one review grade using PROJECT_SPEC SM-2 math. */
  applyReview(quality: QualityScore): SM2State {
    this.sm2State = calculateNextReview(this.sm2State, quality);
    return this.getSm2State();
  }

  async fetch(request: Request): Promise<Response> {
    return new Response(
      JSON.stringify({
        ok: true,
        message: "MemorizationSession stub",
        sm2: this.getSm2State(),
      }),
      { headers: { "content-type": "application/json" } }
    );
  }
}
