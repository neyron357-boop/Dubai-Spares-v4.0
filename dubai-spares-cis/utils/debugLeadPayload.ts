import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../cloudConfig';

export const debugLeadPayload = async (leadId: string) => {
  console.log('[debugLeadPayload] Fetching lead:', leadId);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/client_leads?id=eq.${leadId}&select=*`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    const data = await response.json();

    if (data && data.length > 0) {
      const lead = data[0];
      console.log('[debugLeadPayload] Lead data:', {
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        hasPayloadJson: Boolean(lead.payload_json),
        payloadJsonType: typeof lead.payload_json,
        payloadJsonPreview: lead.payload_json
          ? JSON.stringify(lead.payload_json).substring(0, 200)
          : null,
        hasPayloadB64: Boolean(lead.payload_b64),
        payloadB64Length: lead.payload_b64?.length || 0,
        payloadCodec: lead.payload_codec,
        hasPayload: Boolean(lead.payload),
        payloadType: typeof lead.payload
      });

      return lead;
    }

    console.error('[debugLeadPayload] Lead not found');
    return null;
  } catch (error) {
    console.error('[debugLeadPayload] Error:', error);
    return null;
  }
};

if (typeof window !== 'undefined') {
  (window as Window & { debugLeadPayload?: typeof debugLeadPayload }).debugLeadPayload = debugLeadPayload;
}
