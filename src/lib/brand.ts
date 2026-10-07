// Single source of truth for the retailer and brand names shown in the app.
// Keep in sync with the constants at the top of scripts/generate-data.mjs.
// Engine logic never matches on these names: it uses the `is_our_brand` column.
export const RETAILER_NAME = 'Reliance Fresh';
export const OUR_BRAND_NAME = 'Reliance Fresh';
/** "our brand (Reliance Fresh)": use once where the name helps */
export const OUR_BRAND_LABEL = `our brand (${OUR_BRAND_NAME})`;
export const DATA_NOTE = `Simulated demo data. Not actual ${RETAILER_NAME} data.`;
