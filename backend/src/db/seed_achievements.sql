-- Seed: Neos City achievement catalog (v2 — series-specific)
INSERT INTO achievements (id, name, description, icon, category, series) VALUES

-- Community & Participation
('first_tournament',  'Enter the Ferrum League',     'Participate in your first tournament.',                       '🏟️', 'community', NULL),
('community_regular', 'Community Regular',           'Attend 10 total tournament events.',                         '📅',  'community', NULL),
('community_veteran', 'Showing Up',                  'Attend 25 total tournament events.',                         '🎖️', 'community', NULL),
('lifeblood',         'Lifeblood of the Scene',      'Attend 50 total tournament events.',                         '❤️',  'community', NULL),
('community_pillar',  'Community Pillar',            'Play 100 total sets across all tournaments.',                '🏛️', 'community', NULL),
('first_win',         'First Blood',                 'Win your first set.',                                        '⚔️',  'community', NULL),

-- Open / Any Tournament
('elite_four',        'Elite Four',                  'Place top 4 in any tournament.',                             '4️⃣',  'open',    NULL),
('champion',          'Champion',                    'Win any tournament.',                                        '🏆',  'open',    NULL),
('grand_champion',    'Grand Champion',              'Win 3 tournaments across any series.',                       '👑',  'open',    NULL),
('took_a_game',       'Made Them Work',              'Take a game off a tournament winner in any set (lose 1–2).', '😤',  'open',    NULL),
('dark_horse',        'Dark Horse',                  'Beat a player in the top 5 of the career leaderboard.',      '🐴',  'open',    NULL),
('never_give_up',     'Never Give Up',               'Win a set after losing the first game.',                     '🔥',  'open',    NULL),

-- Ferrum Fist Challenge
('ffc_debut',         'Ferrum Faithful',             'Enter your first Ferrum Fist Challenge.',                    '✊',  'ffc',     'ffc'),
('ffc_regular',       'FFC Regular',                 'Attend 10 Ferrum Fist Challenge events.',                   '📌',  'ffc',     'ffc'),
('ffc_veteran',       'FFC Veteran',                 'Attend 25 Ferrum Fist Challenge events.',                   '🏅',  'ffc',     'ffc'),
('ffc_elite_four',    'FFC Elite Four',              'Place top 4 in a Ferrum Fist Challenge event.',              '4️⃣',  'ffc',     'ffc'),
('ffc_champion',      'FFC Champion',                'Win a Ferrum Fist Challenge event.',                         '🏆',  'ffc',     'ffc'),
('ffc_grand_champion','FFC Grand Champion',          'Win 3 Ferrum Fist Challenge events.',                        '👑',  'ffc',     'ffc'),

-- RTG NA
('rtgna_debut',       'Road Warrior',                'Enter your first Road to Greatness NA event.',               '🛣️', 'rtg_na',  'rtg_na'),
('rtgna_regular',     'RTG Regular',                 'Attend 10 Road to Greatness NA events.',                    '📌',  'rtg_na',  'rtg_na'),
('rtgna_elite_four',  'RTG Elite Four',              'Place top 4 in a Road to Greatness NA event.',               '4️⃣',  'rtg_na',  'rtg_na'),
('rtgna_champion',    'RTG Champion',                'Win a Road to Greatness NA event.',                          '🏆',  'rtg_na',  'rtg_na'),
('rtgna_grand_champion','RTG Grand Champion',        'Win 3 Road to Greatness NA events.',                         '👑',  'rtg_na',  'rtg_na'),

-- RTG EU
('rtgeu_debut',       'EU Challenger',               'Enter your first Road to Greatness EU event.',               '🌍',  'rtg_eu',  'rtg_eu'),
('rtgeu_elite_four',  'RTG EU Elite Four',           'Place top 4 in a Road to Greatness EU event.',               '4️⃣',  'rtg_eu',  'rtg_eu'),
('rtgeu_champion',    'RTG EU Champion',             'Win a Road to Greatness EU event.',                          '🏆',  'rtg_eu',  'rtg_eu'),
('rtgeu_grand_champion','RTG EU Grand Champion',     'Win 3 Road to Greatness EU events.',                         '👑',  'rtg_eu',  'rtg_eu'),

-- DCM Monthly
('dcm_debut',         'Monthly Attendee',            'Enter your first DCM monthly event.',                        '📆',  'dcm',     'dcm'),
('dcm_regular',       'DCM Regular',                 'Attend 5 DCM monthly events.',                              '📌',  'dcm',     'dcm'),
('dcm_elite_four',    'DCM Elite Four',              'Place top 4 in a DCM monthly event.',                        '4️⃣',  'dcm',     'dcm'),
('dcm_champion',      'DCM Champion',                'Win a DCM monthly event.',                                   '🏆',  'dcm',     'dcm'),
('dcm_grand_champion','DCM Grand Champion',          'Win 3 DCM monthly events.',                                  '👑',  'dcm',     'dcm'),

-- The Croissant Cup (EU)
('tcc_debut',         'TCC Debut',                   'Enter your first The Croissant Cup event.',                  '🥐',  'tcc',     'tcc'),
('tcc_regular',       'TCC Regular',                 'Attend 10 The Croissant Cup events.',                       '📌',  'tcc',     'tcc'),
('tcc_elite_four',    'TCC Elite Four',              'Place top 4 in a The Croissant Cup event.',                  '4️⃣',  'tcc',     'tcc'),
('tcc_champion',      'TCC Champion',                'Win a The Croissant Cup event.',                             '🏆',  'tcc',     'tcc'),
('tcc_grand_champion','TCC Grand Champion',          'Win 3 The Croissant Cup events.',                            '👑',  'tcc',     'tcc'),

-- End of the Road
('eotr_debut',        'End of the Road',             'Enter your first End of the Road event.',                    '🛤️', 'eotr',    'eotr'),
('eotr_regular',      'EOTR Regular',                'Attend 5 End of the Road events.',                          '📌',  'eotr',    'eotr'),
('eotr_elite_four',   'EOTR Elite Four',             'Place top 4 in an End of the Road event.',                   '4️⃣',  'eotr',    'eotr'),
('eotr_champion',     'EOTR Champion',               'Win an End of the Road event.',                              '🏆',  'eotr',    'eotr'),
('eotr_grand_champion','EOTR Grand Champion',        'Win 3 End of the Road events.',                              '👑',  'eotr',    'eotr'),

-- ねずみ杯 (Mouse Cup) — JP main series
('nezumi_debut',         'ねずみ杯 Debut',             'Enter your first Nezumi Cup event.',                         '🐭',  'nezumi',          'nezumi'),
('nezumi_regular',       'ねずみ杯 Regular',           'Attend 5 Nezumi Cup events.',                               '📌',  'nezumi',          'nezumi'),
('nezumi_veteran',       'ねずみ杯 Veteran',           'Attend 10 Nezumi Cup events.',                              '🏅',  'nezumi',          'nezumi'),
('nezumi_elite_four',    'ねずみ杯 Elite Four',        'Place top 4 in a Nezumi Cup event.',                        '4️⃣',  'nezumi',          'nezumi'),
('nezumi_champion',      'ねずみ杯 Champion',          'Win a Nezumi Cup event.',                                   '🏆',  'nezumi',          'nezumi'),
('nezumi_grand_champion','ねずみ杯 Grand Champion',    'Win 3 Nezumi Cup events.',                                  '👑',  'nezumi',          'nezumi'),

-- ねずみ杯Rookies — JP rookies division
('nezumi_rookies_debut',         'Rookies Debut',              'Enter your first Nezumi Cup Rookies event.',                 '🌱',  'nezumi_rookies',  'nezumi_rookies'),
('nezumi_rookies_elite_four',    'Rookies Elite Four',         'Place top 4 in a Nezumi Cup Rookies event.',                 '4️⃣',  'nezumi_rookies',  'nezumi_rookies'),
('nezumi_rookies_champion',      'Rookies Champion',           'Win a Nezumi Cup Rookies event.',                            '🏆',  'nezumi_rookies',  'nezumi_rookies'),
('nezumi_rookies_grand_champion','Rookies Grand Champion',     'Win 3 Nezumi Cup Rookies events.',                           '👑',  'nezumi_rookies',  'nezumi_rookies')

ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  icon        = EXCLUDED.icon,
  category    = EXCLUDED.category,
  series      = EXCLUDED.series;
