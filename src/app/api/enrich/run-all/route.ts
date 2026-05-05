import { NextResponse } from 'next/server';

// ════════════════════════════════════════════════════════
// POST /api/enrich/run-all
//
// Auto-loops through ALL unenriched leads in the database,
// calling the batch endpoint repeatedly until done.
// Standard (Free) only — no Apify costs.
//
// Uses streaming to report progress in real-time.
// ════════════════════════════════════════════════════════

export const maxDuration = 300; // 5 min max for Vercel

export async function POST(request: Request) {
  const { projectId = 'glowup', industry, state, city } = await request.json();

  const baseUrl = request.url.replace('/enrich/run-all', '/enrich/batch');

  const encoder = new TextEncoder();
  let totalProcessed = 0;
  let totalEnriched = 0;
  let batchNum = 0;
  let offset = 0;
  const batchLimit = 30; // leads per API call

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ type: 'start', message: 'Starting full enrichment run...' });

        // eslint-disable-next-line no-constant-condition
        while (true) {
          batchNum++;

          const body: Record<string, unknown> = {
            projectId,
            offset,
            limit: batchLimit,
            batchSize: 5,
            enableGoogle: true,
            enableSocial: true,
            enableApify: false, // Standard only — no cost
          };
          if (industry) body.industry = industry;
          if (state) body.state = state;
          if (city) body.city = city;

          const res = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            send({ type: 'error', message: `Batch ${batchNum} failed: ${res.statusText}` });
            break;
          }

          const data = await res.json();

          if (data.done || data.processed === 0) {
            send({ type: 'complete', totalProcessed, totalEnriched, batches: batchNum });
            break;
          }

          totalProcessed += data.processed || 0;
          totalEnriched += data.enriched || 0;

          send({
            type: 'progress',
            batch: batchNum,
            processed: totalProcessed,
            enriched: totalEnriched,
            remaining: data.remaining || 0,
            batchEnriched: data.enriched || 0,
            sources: data.sources || {},
          });

          // Move to next batch
          offset += batchLimit;

          // Safety: prevent infinite loops
          if (batchNum > 2000) {
            send({ type: 'error', message: 'Safety limit reached (2000 batches)' });
            break;
          }

          // Small delay between batches to not overwhelm the server
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
