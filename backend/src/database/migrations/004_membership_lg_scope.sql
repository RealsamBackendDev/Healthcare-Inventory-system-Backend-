CREATE OR REPLACE FUNCTION set_membership_local_government()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.healthcare_centre_id IS NOT NULL THEN
        SELECT hc.local_government_id
          INTO NEW.local_government_id
          FROM healthcare_centres hc
         WHERE hc.id = NEW.healthcare_centre_id;
    END IF;

    IF NEW.local_government_id IS NULL THEN
        RAISE EXCEPTION 'A membership must belong to a healthcare centre or a local government';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_memberships_set_lg ON user_memberships;

CREATE TRIGGER user_memberships_set_lg
BEFORE INSERT OR UPDATE ON user_memberships
FOR EACH ROW
EXECUTE FUNCTION set_membership_local_government();

UPDATE user_memberships m
   SET local_government_id = hc.local_government_id
  FROM healthcare_centres hc
 WHERE hc.id = m.healthcare_centre_id
   AND m.local_government_id IS DISTINCT FROM hc.local_government_id;
