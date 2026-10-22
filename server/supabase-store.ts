import { PostgresStore } from './postgres-store.ts';
import { APIError } from './validation.ts';

export interface GoogleIdentity { id: string; email: string; name: string; googleSubject: string; authoritativeEmail?: boolean }

export class SupabaseStore extends PostgresStore {
  protected override ownerScope(parameter: number) {
    return `(owner_id = $${parameter} or owner_id in
      (select owner_id from fynd_qr.auth_owner_links where auth_user_id = $${parameter}))`;
  }
  async linkIdentity(user: GoogleIdentity) {
    const disabled=await this.sql.query(`select p.id from fynd_qr.password_accounts p
      join fynd_qr.auth_owner_links l on l.owner_id=p.id where l.auth_user_id=$1 and p.disabled limit 1`,[user.id]);
    if (disabled.rows.length) throw new APIError(403, 'This account is disabled. Contact the site owner.');
    const credential = await this.getCredentialByEmail(user.email);
    if (credential?.disabled) throw new APIError(403, 'This account is disabled. Contact the site owner.');
    let claimManual=!!credential && user.authoritativeEmail===true;
    if (credential && !claimManual) {
      const approved=await this.sql.query(`select owner_id from fynd_qr.owner_claim_approvals where owner_id=$1 and auth_user_id=$2
        union select owner_id from fynd_qr.auth_owner_links where owner_id=$1 and auth_user_id=$2`,[credential._id,user.id]);
      claimManual=approved.rows.length>0;
      if (!claimManual && ((await this.countCodes(credential._id))>0 || (await this.countLogos(credential._id))>0)) throw new APIError(409, 'Your previous workspace needs an ownership check. Contact the site owner; your saved codes and links are preserved.');
    }
    const aliases = [...new Set([user.googleSubject, ...(credential && claimManual ? [credential._id] : [])])];
    try { await this.sql.query('select fynd_qr.link_owner_identity($1,$2)', [user.id, aliases]); }
    catch (error) {
      if ((error as { code?: string }).code === '23505') throw new APIError(409, 'Your existing workspace needs an identity review. Contact the site owner; your saved codes are preserved.');
      throw error;
    }
  }
  async rateLimit(bucket: string, maximum: number, seconds = 60) {
    const { rows: [row] } = await this.sql.query('select fynd_qr.take_rate_limit($1,$2,$3) as allowed', [bucket, maximum, seconds]);
    return row.allowed === true;
  }
  override async health() {
    await super.health();
    await this.sql.query('select owner_id from fynd_qr.auth_owner_links limit 0');
    await this.sql.query('select bucket from fynd_qr.request_limits limit 0');
    await this.sql.query('select owner_id from fynd_qr.owner_claim_approvals limit 0');
  }
  override async cleanup(now = new Date()) {
    await super.cleanup(now);
    await this.sql.query('delete from fynd_qr.request_limits where starts_at < $1', [new Date(+now - 86400_000)]);
  }
}
