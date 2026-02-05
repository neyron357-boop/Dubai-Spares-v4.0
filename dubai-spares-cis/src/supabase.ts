import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dykqzgiknajteuzxxvmb.supabase.co';
const supabaseKey = 'sb_publishable_h5QTAi3PrT5EpqoHdD6suw_pAUwpGNM';

export const supabase = createClient(supabaseUrl, supabaseKey);
