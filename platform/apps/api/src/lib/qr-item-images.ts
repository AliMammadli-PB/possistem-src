/** Artwork is independent from POS prices/recipes and survives a POS menu re-publication. */
export const QR_ITEM_IMAGES_DDL=`CREATE TABLE IF NOT EXISTS restaurant_qr_item_images(
 menu_id uuid NOT NULL REFERENCES restaurant_qr_menus(id) ON DELETE CASCADE,
 product_id text NOT NULL,image text NOT NULL CHECK(length(image)<=1800 AND image LIKE 'https://%'),
 source text NOT NULL DEFAULT 'owner',updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(menu_id,product_id))`;
export function withQrItemImages<T extends {items:Array<{id:string;image?:string}>}>(document:T,artwork:Array<{product_id:string;image:string}>):T{
 const images=new Map(artwork.filter(row=>row.image.startsWith('https://')&&row.image.length<=1800).map(row=>[row.product_id,row.image]));
 return {...document,items:document.items.map(item=>item.image||!images.has(item.id)?item:{...item,image:images.get(item.id)!})};
}
