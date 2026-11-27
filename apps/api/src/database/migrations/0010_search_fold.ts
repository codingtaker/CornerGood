import { Kysely, sql } from 'kysely';

/*
 * Search (contract §4.1, ADR-014): "ecran" must find "Remplacement d'écran",
 * and "SANTE" the category "Santé". search_fold() puts a text in lowercase
 * without its accents, the same way the API folds the words typed (NFD, marks
 * removed, lowercase: search-input.ts), so both sides compare.
 *
 * translate() instead of the unaccent extension: nothing to install, and the
 * function can be IMMUTABLE, so an index on search_fold(name) stays possible
 * if Grand Lomé ever has too many listings for a sequential scan. Uppercase
 * accented letters are listed too, whatever the collation does with lower().
 */

const FROM = 'ÀÂÄÁÃÅàâäáãåÇçÉÈÊËéèêëÍÌÎÏíìîïÑñÓÒÔÖÕóòôöõÚÙÛÜúùûüŸÿ';
const TO = 'aaaaaaaaaaaacceeeeeeeeiiiiiiiinnoooooooooouuuuuuuuyy';

export async function up(db: Kysely<unknown>): Promise<void> {
  if ([...FROM].length !== [...TO].length) {
    throw new Error('search_fold: both alphabets must have the same length');
  }
  await sql`
    CREATE FUNCTION search_fold(value text) RETURNS text
      LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
      RETURN lower(translate(value, ${sql.lit(FROM)}, ${sql.lit(TO)}));

    COMMENT ON FUNCTION search_fold(text) IS
      'Lowercase without accents, for the public search (contract §4.1).';
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS search_fold(text);`.execute(db);
}
