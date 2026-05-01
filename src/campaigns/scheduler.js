import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import pool from '../db/pool.js';
import { getSegmentContacts } from '../contacts/segmentation.js';
import { renderEmail } from './spinner.js';
import { sendBatch } from '../smtp/sender.js';

const redis = new IORedis({
  host:     process.env.REDIS_HOST || 'localhost',
  password: process.env.REDIS_PASS || undefined,
  maxRetriesPerRequest: null,
});

export const campaignQueue = new Queue('campaigns', { connection: redis });
export const ftpQueue      = new Queue('ftp-imports', { connection: redis });

export async function registerFtpCrons() {
  const { rows: dealers } = await pool.query(
    `SELECT id, slug, ftp_schedule FROM dealers WHERE ftp_host IS NOT NULL`
  );
  for (const dealer of dealers) {
    await ftpQueue.upsertJobScheduler(
      `ftp-${dealer.slug}`,
      { pattern: dealer.ftp_schedule || '0 6 * * *' },
      { name: 'ftp-import', data: { dealerId: dealer.id } }
    );
    console.log(`FTP cron registered for ${dealer.slug}`);
  }
}

export const campaignWorker = new Worker('campaigns', async (job) => {
  const { campaignId } = job.data;
  const { rows: [campaign] } = await pool.query(`SELECT * FROM campaigns WHERE id=$1`, [campaignId]);
  const { rows: [dealer]   } = await pool.query(`SELECT * FROM dealers   WHERE id=$1`, [campaign.dealer_id]);
  const { rows: vehicles   } = await pool.query(
    `SELECT * FROM vehicles WHERE id=ANY($1::uuid[])`, [campaign.vehicle_ids]
  );

  const segment = campaign.segment_id
    ? (await pool.query(`SELECT * FROM segments WHERE id=$1`, [campaign.segment_id])).rows[0]
    : null;
  const contacts = await getSegmentContacts(dealer.id, segment?.filters || {});

  await pool.query(`UPDATE campaigns SET status='sending' WHERE id=$1`, [campaignId]);

  const sendsToProcess = [];
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const vehicle = vehicles[i % vehicles.length];
    const vdpHref = buildVdpHref(vehicle, contact, campaign);
    const unsubUrl = `https://${process.env.TRACKING_DOMAIN}/unsubscribe?cid=${contact.id}`;
    const { subject, html } = renderEmail({
      subjectTemplate: campaign.subject_template,
      bodyTemplate:    campaign.body_template,
      contact, vehicle, campaign, dealer, vdpHref, unsubUrl,
    });
    const { rows: [send] } = await pool.query(
      `INSERT INTO sends (campaign_id,contact_id,vehicle_id,step_index,subject,status) VALUES ($1,$2,$3,0,$4,'queued') RETURNING id`,
      [campaignId, contact.id, vehicle.id, subject]
    );
    sendsToProcess.push({ ...send, contact, vehicle, subject, html });
  }

  const { sent, errors } = await sendBatch({ sends: sendsToProcess, campaign, dealer });
  await pool.query(`UPDATE campaigns SET status='sent', updated_at=NOW() WHERE id=$1`, [campaignId]);
  return { sent, errors, total: contacts.length };
}, { connection: redis, concurrency: 1 });

function buildVdpHref(vehicle, contact, campaign) {
  try {
    const url = new URL(vehicle.vdp_url);
    url.searchParams.set('utm_source',   'email');
    url.searchParams.set('utm_medium',   'cold_email');
    url.searchParams.set('utm_campaign', campaign.id);
    url.searchParams.set('vid',          vehicle.vin);
    url.searchParams.set('cid',          contact.id);
    const redirect = new URL(`https://${process.env.TRACKING_DOMAIN}/t/click`);
    redirect.searchParams.set('sid', contact.sendId || '');
    redirect.searchParams.set('vid', vehicle.id);
    redirect.searchParams.set('url', url.toString());
    return `<a href="${redirect.toString()}">${vehicle.year} ${vehicle.make} ${vehicle.model}</a>`;
  } catch {
    return vehicle.vdp_url;
  }
}
