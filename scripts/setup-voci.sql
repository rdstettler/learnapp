-- Create the voci table (Language Generic)
CREATE TABLE IF NOT EXISTS public.voci (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lang_code VARCHAR(10) NOT NULL,
    de_word TEXT NOT NULL,
    target_word TEXT NOT NULL,
    topic TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.voci ENABLE ROW LEVEL SECURITY;

-- Allow read access for everyone
CREATE POLICY "Allow public read access on voci"
ON public.voci
FOR SELECT USING (true);


-- Insert French word pairs
INSERT INTO public.voci (lang_code, de_word, target_word, topic) VALUES
-- Food (15 words)
('fr', 'der Apfel', 'la pomme', 'food'),
('fr', 'das Brot', 'le pain', 'food'),
('fr', 'das Wasser', 'l''eau (f)', 'food'),
('fr', 'der Käse', 'le fromage', 'food'),
('fr', 'der Wein', 'le vin', 'food'),
('fr', 'die Milch', 'le lait', 'food'),
('fr', 'das Fleisch', 'la viande', 'food'),
('fr', 'das Gemüse', 'les légumes (m)', 'food'),
('fr', 'die Frucht', 'le fruit', 'food'),
('fr', 'der Fisch', 'le poisson', 'food'),
('fr', 'die Kartoffel', 'la pomme de terre', 'food'),
('fr', 'das Ei', 'l''œuf (m)', 'food'),
('fr', 'die Suppe', 'la soupe', 'food'),
('fr', 'der Kaffee', 'le café', 'food'),
('fr', 'das Dessert', 'le dessert', 'food'),

-- Colors (12 words)
('fr', 'rot', 'rouge', 'colors'),
('fr', 'blau', 'bleu', 'colors'),
('fr', 'gelb', 'jaune', 'colors'),
('fr', 'grün', 'vert', 'colors'),
('fr', 'schwarz', 'noir', 'colors'),
('fr', 'weiß', 'blanc', 'colors'),
('fr', 'grau', 'gris', 'colors'),
('fr', 'braun', 'marron', 'colors'),
('fr', 'orange', 'orange', 'colors'),
('fr', 'rosa', 'rose', 'colors'),
('fr', 'lila', 'violet', 'colors'),
('fr', 'hellblau', 'bleu clair', 'colors'),

-- Nature (13 words)
('fr', 'der Baum', 'l''arbre (m)', 'nature'),
('fr', 'die Blume', 'la fleur', 'nature'),
('fr', 'der Wald', 'la forêt', 'nature'),
('fr', 'das Meer', 'la mer', 'nature'),
('fr', 'der Berg', 'la montagne', 'nature'),
('fr', 'die Sonne', 'le soleil', 'nature'),
('fr', 'der Mond', 'la lune', 'nature'),
('fr', 'der Stern', 'l''étoile (f)', 'nature'),
('fr', 'der Himmel', 'le ciel', 'nature'),
('fr', 'die Erde', 'la terre', 'nature'),
('fr', 'der See', 'le lac', 'nature'),
('fr', 'der Fluss', 'le fleuve', 'nature'),
('fr', 'die Landschaft', 'le paysage', 'nature'),

-- Activities (10 words)
('fr', 'schwimmen', 'nager', 'activities'),
('fr', 'lesen', 'lire', 'activities'),
('fr', 'schreiben', 'écrire', 'activities'),
('fr', 'singen', 'chanter', 'activities'),
('fr', 'tanzen', 'danser', 'activities'),
('fr', 'laufen', 'courir', 'activities'),
('fr', 'spielen', 'jouer', 'activities'),
('fr', 'arbeiten', 'travailler', 'activities'),
('fr', 'essen', 'manger', 'activities'),
('fr', 'schlafen', 'dormir', 'activities');

-- Insert English word pairs
INSERT INTO public.voci (lang_code, de_word, target_word, topic) VALUES
-- Food
('en', 'der Apfel', 'the apple', 'food'),
('en', 'das Brot', 'the bread', 'food'),
('en', 'das Wasser', 'the water', 'food'),
('en', 'der Käse', 'the cheese', 'food'),
('en', 'der Wein', 'the wine', 'food'),
('en', 'die Milch', 'the milk', 'food'),
('en', 'das Fleisch', 'the meat', 'food'),
('en', 'das Gemüse', 'the vegetables', 'food'),
('en', 'die Frucht', 'the fruit', 'food'),
('en', 'der Fisch', 'the fish', 'food'),
('en', 'die Kartoffel', 'the potato', 'food'),
('en', 'das Ei', 'the egg', 'food'),
('en', 'die Suppe', 'the soup', 'food'),
('en', 'der Kaffee', 'the coffee', 'food'),
('en', 'das Dessert', 'the dessert', 'food'),

-- Colors
('en', 'rot', 'red', 'colors'),
('en', 'blau', 'blue', 'colors'),
('en', 'gelb', 'yellow', 'colors'),
('en', 'grün', 'green', 'colors'),
('en', 'schwarz', 'black', 'colors'),
('en', 'weiß', 'white', 'colors'),
('en', 'grau', 'gray', 'colors'),
('en', 'braun', 'brown', 'colors'),
('en', 'orange', 'orange', 'colors'),
('en', 'rosa', 'pink', 'colors'),
('en', 'lila', 'purple', 'colors'),
('en', 'hellblau', 'light blue', 'colors'),

-- Nature
('en', 'der Baum', 'the tree', 'nature'),
('en', 'die Blume', 'the flower', 'nature'),
('en', 'der Wald', 'the forest', 'nature'),
('en', 'das Meer', 'the sea', 'nature'),
('en', 'der Berg', 'the mountain', 'nature'),
('en', 'die Sonne', 'the sun', 'nature'),
('en', 'der Mond', 'the moon', 'nature'),
('en', 'der Stern', 'the star', 'nature'),
('en', 'der Himmel', 'the sky', 'nature'),
('en', 'die Erde', 'the earth', 'nature'),
('en', 'der See', 'the lake', 'nature'),
('en', 'der Fluss', 'the river', 'nature'),
('en', 'die Landschaft', 'the landscape', 'nature'),

-- Activities
('en', 'schwimmen', 'to swim', 'activities'),
('en', 'lesen', 'to read', 'activities'),
('en', 'schreiben', 'to write', 'activities'),
('en', 'singen', 'to sing', 'activities'),
('en', 'tanzen', 'to dance', 'activities'),
('en', 'laufen', 'to run', 'activities'),
('en', 'spielen', 'to play', 'activities'),
('en', 'arbeiten', 'to work', 'activities'),
('en', 'essen', 'to eat', 'activities'),
('en', 'schlafen', 'to sleep', 'activities');
