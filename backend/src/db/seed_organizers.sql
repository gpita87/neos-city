-- Seed: Known tournament organizers for the Neos City organizer pool
-- Run this in Supabase SQL Editor after add_organizers_eotr.sql

INSERT INTO organizers (challonge_username, display_name, notes) VALUES
  ('wise_',            'Wise',          'Ferrum Fist Challenge host'),
  ('shean96',          'Shean',         'Road to Greatness NA host'),
  ('rigz_',            'Rigz',          'Road to Greatness NA host'),
  ('devlinhartfgc',    'Devlin Hart',   'DCM Monthly host'),
  ('__chepestoopid',   'ChepeStoopid',  'Road to Greatness EU host'),
  ('__auradiance',     'Auradiance',    'The Croissant Cup host'),
  ('rickythe3rd',      'RickyThe3rd',  'Ferrum Fist Challenge host')
ON CONFLICT (challonge_username) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  notes        = EXCLUDED.notes;
