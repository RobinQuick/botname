import { logger } from './logger';

export class MetricsCollector {
    recordSessionEnd(session: any) {
        logger.info({
            sessionId: session.id,
            metrics: session.metrics
        }, 'Session metrics');
    }

    recordFallback(sessionId: string, reason: string) {
        logger.info({
            sessionId,
            reason,
            metric: 'fallback_to_human'
        }, 'Fallback recorded');
    }
}
