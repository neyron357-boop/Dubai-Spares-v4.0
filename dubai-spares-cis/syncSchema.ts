export const ORDER_GRAPH_COLUMNS = [
  'id','brand','model','year','body_type','vin','vin_photo_url','priority','client_name','source','car_photo_url','car_photos','markup_percent','markup_type','markup_fixed_aed','use_markup_as_default_for_new_parts','client_currency','fx_updated_at','logistics','exchange_rate','created_at','is_archived','is_sold','sold_profit_usd','is_vip','is_pinned','is_lead','notes','status','sales_status','customer_contact','social_nickname','updated_at','recommended_shop_ids','dismissed_shop_ids','lead_unread','lead_source','lead_read_at','pricing_events'
] as const;

export const COMPAT_TABLE_COLUMNS = {
  orders: [...ORDER_GRAPH_COLUMNS],
  parts: ['id','order_id','name','photo_url','photos','is_found'],
  price_variants: ['id','part_id','price_aed','condition','availability','shop_name','phone','location','photo_url','photos','created_at'],
  public_quote_snapshots: ['id','order_id','payload','created_at','expires_at']
} as const;
