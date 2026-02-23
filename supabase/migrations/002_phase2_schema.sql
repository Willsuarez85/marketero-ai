-- Marketero AI — Phase 2 Schema Changes
-- Migration 002: Brand memory fields, client memory log, job types, industry seed data
-- Date: 2026-02-23

-- ============================================================
-- 1. ALTER client_brains — add brand memory columns
-- ============================================================
ALTER TABLE client_brains ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE client_brains ADD COLUMN IF NOT EXISTS brand_colors JSONB DEFAULT '{}';
ALTER TABLE client_brains ADD COLUMN IF NOT EXISTS typography JSONB DEFAULT '{}';
ALTER TABLE client_brains ADD COLUMN IF NOT EXISTS important_dates JSONB DEFAULT '[]';
ALTER TABLE client_brains ADD COLUMN IF NOT EXISTS content_themes JSONB DEFAULT '[]';
ALTER TABLE client_brains ADD COLUMN IF NOT EXISTS dos_and_donts JSONB DEFAULT '{"dos": [], "donts": []}';
ALTER TABLE client_brains ADD COLUMN IF NOT EXISTS competitor_notes TEXT;
ALTER TABLE client_brains ADD COLUMN IF NOT EXISTS onboarding_notes TEXT;

-- ============================================================
-- 2. CREATE TABLE client_memory_log
-- ============================================================
CREATE TABLE client_memory_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    memory_type     TEXT NOT NULL
                    CHECK (memory_type IN ('approval','rejection','feedback','preference','interaction')),
    content         TEXT NOT NULL,
    context         JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_memory_log_restaurant ON client_memory_log(restaurant_id, created_at DESC);

-- ============================================================
-- 3. ALTER scheduled_jobs — expand job_type CHECK constraint
-- ============================================================
ALTER TABLE scheduled_jobs DROP CONSTRAINT IF EXISTS scheduled_jobs_job_type_check;
ALTER TABLE scheduled_jobs ADD CONSTRAINT scheduled_jobs_job_type_check
    CHECK (job_type IN (
        'daily_content', 'autopilot_publish', 'reminder',
        'bridge_nurture', 'publish_buffer',
        'consolidate_brain', 'agent_self_review'
    ));

-- ============================================================
-- 4. INSERT industry_brain seed data for Mexican restaurants
-- ============================================================
INSERT INTO industry_brain (category, insight, cuisine_type, season, is_active) VALUES
    ('promotion', 'Los martes de tacos (Taco Tuesday) son el día con más engagement en redes para restaurantes mexicanos. Ofrece un especial y publícalo el lunes por la noche.', 'mexican', 'all', TRUE),
    ('promotion', 'Los combos familiares para fin de semana generan tickets promedio 40% más altos. Destaca el valor y la cantidad de comida.', 'mexican', 'all', TRUE),
    ('promotion', 'Happy hour con micheladas y botanas tiene alta conversión en Instagram Stories. Usa fotos reales de las bebidas.', 'mexican', 'all', TRUE),
    ('content', 'Los videos cortos del chef preparando platillos generan 3x más engagement que fotos estáticas. Muestra el fuego, el sazón, la acción.', 'mexican', 'all', TRUE),
    ('content', 'Posts con historia personal del dueño o la familia conectan emocionalmente. "Mi abuela me enseñó esta receta..." funciona muy bien.', 'mexican', 'all', TRUE),
    ('content', 'Fotos de antes/después de platillos (ingredientes crudos → plato final) generan curiosidad y saves en Instagram.', 'mexican', 'all', TRUE),
    ('seasonal', 'Día de los Muertos (Nov 1-2): pan de muerto, altar del restaurante, menú especial. Contenido con alta viralidad en comunidad latina.', 'mexican', 'fall', TRUE),
    ('seasonal', 'Cinco de Mayo: No es solo margaritas. Destaca la autenticidad de tu comida vs cadenas americanas. Orgullo mexicano vende.', 'mexican', 'spring', TRUE),
    ('seasonal', 'Navidad y Año Nuevo: tamales, ponche, buñuelos. Pedidos anticipados para llevar son oro para restaurantes mexicanos.', 'mexican', 'winter', TRUE),
    ('seasonal', 'Cuaresma: platillos de mariscos y pescado. Muchos latinos buscan opciones durante Cuaresma — camarones, ceviche, pescado empanizado.', 'mexican', 'spring', TRUE),
    ('trend', 'El birria trend sigue fuerte: birria tacos, birria ramen, birria pizza. Si lo tienes en menú, dale push constante.', 'mexican', 'all', TRUE),
    ('trend', 'Elote y esquites en diferentes presentaciones están trending. Muestra creatividad con variaciones.', 'mexican', 'summer', TRUE),
    ('content', 'Los posts que mencionan ingredientes frescos y preparación diaria generan más confianza. "Hecho hoy, con ingredientes frescos" es un mensaje poderoso.', 'mexican', 'all', TRUE),
    ('promotion', 'Los especiales de almuerzo (lunch specials) atraen tráfico en horarios bajos. Publica a las 10am para captar la decisión del almuerzo.', 'mexican', 'all', TRUE),
    ('trend', 'Comida mexicana saludable está creciendo: bowls de pollo, opciones sin gluten, ensaladas con proteína. Apela a la audiencia health-conscious sin perder autenticidad.', 'mexican', 'all', TRUE);
