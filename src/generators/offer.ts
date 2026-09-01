import type { AigentifyConfig } from "../config.js";

export function generateOffer(config: AigentifyConfig): string {
  const offer = config.offer ?? {};
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: config.name,
    description: config.description,
    applicationCategory: "DeveloperApplication",
    offers: [
      {
        "@type": "Offer",
        name: offer.name ?? `${config.name} access`,
        ...(offer.description ? { description: offer.description } : {}),
        ...(offer.price === undefined ? {} : { price: String(offer.price) }),
        priceCurrency: offer.priceCurrency ?? "USD",
      },
    ],
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}
