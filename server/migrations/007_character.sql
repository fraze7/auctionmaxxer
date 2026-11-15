-- The owner's character: which professions it has and at what skill.
-- A row means the character has that profession.
CREATE TABLE character_skills (
  profession TEXT    PRIMARY KEY,
  skill      INTEGER NOT NULL CHECK (skill BETWEEN 1 AND 300)
) STRICT;
