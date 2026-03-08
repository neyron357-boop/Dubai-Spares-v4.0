alter table public.parts
  add column if not exists weight_kg numeric not null default 0,
  add column if not exists length_cm numeric not null default 0,
  add column if not exists width_cm numeric not null default 0,
  add column if not exists height_cm numeric not null default 0,
  add column if not exists places integer not null default 1,
  add column if not exists is_oversized boolean not null default false;

insert into public.app_state (id, data, updated_at)
values (
  'cargo_settings',
  jsonb_build_object(
    'cargoTariffs', jsonb_build_array(
      jsonb_build_object('country','Россия','airUsdPerKg',5.5,'expressAirUsdPerKg',12,'containerUsdPerKg',1.6,'oversizedUsdPerKg',10,'regularUsdPerKg',5.5,'airSeatUsd',10,'minAirKg',10,'minContainerKg',30,'minContainerCbm',1,'airEtaDays','3-7','containerEtaDays','25-40'),
      jsonb_build_object('country','Казахстан','airUsdPerKg',6,'expressAirUsdPerKg',12,'containerUsdPerKg',1.4,'oversizedUsdPerKg',10,'regularUsdPerKg',5.5,'airSeatUsd',10,'minAirKg',10,'minContainerKg',30,'minContainerCbm',1,'airEtaDays','4-7','containerEtaDays','20-35'),
      jsonb_build_object('country','Таджикистан','airUsdPerKg',5,'expressAirUsdPerKg',11,'containerUsdPerKg',1.9,'oversizedUsdPerKg',10,'regularUsdPerKg',5.5,'airSeatUsd',10,'minAirKg',10,'minContainerKg',30,'minContainerCbm',1,'airEtaDays','4-10','containerEtaDays','25-45'),
      jsonb_build_object('country','Узбекистан','airUsdPerKg',5.5,'expressAirUsdPerKg',11,'containerUsdPerKg',1.7,'oversizedUsdPerKg',10,'regularUsdPerKg',5.5,'airSeatUsd',10,'minAirKg',10,'minContainerKg',30,'minContainerCbm',1,'airEtaDays','4-8','containerEtaDays','20-40'),
      jsonb_build_object('country','Кыргызстан','airUsdPerKg',5.5,'expressAirUsdPerKg',11,'containerUsdPerKg',1.8,'oversizedUsdPerKg',10,'regularUsdPerKg',5.5,'airSeatUsd',10,'minAirKg',10,'minContainerKg',30,'minContainerCbm',1,'airEtaDays','4-7','containerEtaDays','20-35')
    )
  ),
  now()
)
on conflict (id) do nothing;
