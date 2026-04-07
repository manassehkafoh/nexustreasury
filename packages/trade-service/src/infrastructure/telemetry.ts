import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export function registerTelemetry(serviceName: string): void {
  const sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: process.env['npm_package_version'] ?? '1.0.0',
    }),
    traceExporter: new OTLPTraceExporter({
      url: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4317',
    }),
  });

  sdk.start();

  process.on('SIGTERM', async () => {
    await sdk.shutdown();
  });
}
