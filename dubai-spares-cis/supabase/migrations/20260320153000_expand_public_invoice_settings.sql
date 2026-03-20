-- Expand persisted public/app settings with invoice payment and company contact fields.
with public_defaults as (
  select jsonb_build_object(
    'publicWebsiteUrl', coalesce(data->>'publicWebsiteUrl', 'https://www.dubaispares.ae'),
    'publicEmail', coalesce(data->>'publicEmail', 'sales@dubaispares.ae'),
    'invoicePaymentAccountNo', coalesce(data->>'invoicePaymentAccountNo', data->>'publicWhatsappNumber', ''),
    'invoicePaymentBeneficiary', coalesce(data->>'invoicePaymentBeneficiary', data->>'publicManagerName', 'Dubai Spares UAE'),
    'invoicePaymentBankAccount', coalesce(data->>'invoicePaymentBankAccount', concat(coalesce(nullif(data->>'publicManagerName', ''), 'Dubai Spares UAE'), ' Trading Account'))
  ) as patch
  from public.app_state
  where id = 'public_settings'
),
app_defaults as (
  select jsonb_build_object(
    'publicWebsiteUrl', coalesce(data->>'publicWebsiteUrl', 'https://www.dubaispares.ae'),
    'publicEmail', coalesce(data->>'publicEmail', 'sales@dubaispares.ae'),
    'invoicePaymentAccountNo', coalesce(data->>'invoicePaymentAccountNo', data->>'publicWhatsappNumber', ''),
    'invoicePaymentBeneficiary', coalesce(data->>'invoicePaymentBeneficiary', data->>'publicManagerName', 'Dubai Spares UAE'),
    'invoicePaymentBankAccount', coalesce(data->>'invoicePaymentBankAccount', concat(coalesce(nullif(data->>'publicManagerName', ''), 'Dubai Spares UAE'), ' Trading Account'))
  ) as patch
  from public.app_state
  where id = 'app_settings'
)
update public.app_state
set data = coalesce(data, '{}'::jsonb) || (
  case
    when id = 'public_settings' then (select patch from public_defaults)
    when id = 'app_settings' then (select patch from app_defaults)
    else '{}'::jsonb
  end
),
updated_at = now()
where id in ('public_settings', 'app_settings');
