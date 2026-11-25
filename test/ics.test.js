const assert = require('assert');
const { parseEvents, cleanUrl } = require('../main/ics.js');
const NOW = Date.parse('2026-11-25T09:00:00Z');
const ics = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN',
  'BEGIN:VTIMEZONE', 'TZID:Europe/London', 'BEGIN:STANDARD', 'DTSTART:19701025T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'END:STANDARD',
  'BEGIN:DAYLIGHT', 'DTSTART:19700329T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'END:DAYLIGHT', 'END:VTIMEZONE',
  // weekly stand-up on Wednesdays at 10:00 London time, started long ago, with one skipped date and a Zoom link
  'BEGIN:VEVENT', 'UID:standup@t', 'DTSTART;TZID=Europe/London:20250101T100000', 'DTEND;TZID=Europe/London:20250101T101500', 'RRULE:FREQ=WEEKLY;BYDAY=WE', 'EXDATE;TZID=Europe/London:20261202T100000',
  'SUMMARY:Stand-up', 'DESCRIPTION:Join https://acme.zoom.us/j/12345?pwd=abc please', 'END:VEVENT',
  // an all-day event, a cancelled one, a past one, one far in the future
  'BEGIN:VEVENT', 'UID:holiday@t', 'DTSTART;VALUE=DATE:20261126', 'DTEND;VALUE=DATE:20261127', 'SUMMARY:Holiday', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:cancel@t', 'DTSTART:20261126T120000Z', 'DTEND:20261126T130000Z', 'STATUS:CANCELLED', 'SUMMARY:Cancelled', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:past@t', 'DTSTART:20261101T120000Z', 'DTEND:20261101T130000Z', 'SUMMARY:Past', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:far@t', 'DTSTART:20270601T120000Z', 'DTEND:20270601T130000Z', 'SUMMARY:Far away', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
const ev = parseEvents(ics, { now: NOW, days: 15 });
const titles = ev.map((e) => e.title);
assert(!titles.includes('Cancelled') && !titles.includes('Past') && !titles.includes('Far away'), 'cancelled, past and far-away events are left out: ' + titles);
assert(titles.includes('Holiday') && ev.find((e) => e.title === 'Holiday').allDay, 'the all-day event is there and marked all-day');
const su = ev.filter((e) => e.title === 'Stand-up');
// Wednesdays in the next 14 days from Wed 25 Nov 09:00Z: 25 Nov (10:00 London = 10:00Z in winter), 2 Dec (skipped: EXDATE), 9 Dec
assert.deepStrictEqual(su.map((e) => new Date(e.start).toISOString()), ['2026-11-25T10:00:00.000Z', '2026-12-09T10:00:00.000Z'], 'weekly rule expanded, EXDATE skipped: ' + su.map((e) => new Date(e.start).toISOString()));
assert.strictEqual(su[0].link, 'https://acme.zoom.us/j/12345?pwd=abc', 'the meeting link is found');
assert(ev.every((e, i) => i === 0 || ev[i - 1].start <= e.start), 'sorted soonest first');
assert.deepStrictEqual(parseEvents('this is not a calendar', { now: NOW }), []);
// meeting links are judged by host: look-alikes written into an invite do not pass
const { isMeetingLink } = require('../main/ics.js');
for (const good of ['https://acme.zoom.us/j/1', 'https://zoom.us/j/1', 'https://meet.google.com/abc-defg-hij', 'https://teams.microsoft.com/l/meetup-join/x']) assert(isMeetingLink(good), 'allows ' + good);
for (const bad of ['https://evil.example/zoom.us', 'https://zoom.us.evil.example/j/1', 'https://notzoom.us/j/1', 'https://user@zoom.us.evil.example/', 'https://zoom.us@evil.example/', 'http://zoom.us/j/1', 'https://zoom.us:8443/j/1', 'javascript:alert(1)', 'https://evil.example/?u=https://zoom.us']) assert(!isMeetingLink(bad), 'refuses ' + bad);
const lookalike = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x@t', 'DTSTART:20261126T100000Z', 'DTEND:20261126T110000Z', 'SUMMARY:Sync', 'DESCRIPTION:see https://evil.example/zoom.us or https://good.zoom.us/j/9', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
assert.strictEqual(parseEvents(lookalike, { now: NOW })[0].link, 'https://good.zoom.us/j/9', 'the first link that is really a meeting link wins');
// urls: only https (webcal is https underneath), nothing else
assert.strictEqual(cleanUrl('webcal://cal.example.com/a.ics'), 'https://cal.example.com/a.ics');
assert.strictEqual(cleanUrl('http://cal.example.com/a.ics'), '');
assert.strictEqual(cleanUrl('file:///c:/x.ics'), '');
assert.strictEqual(cleanUrl('javascript:alert(1)'), '');
assert.strictEqual(cleanUrl('https://cal.example.com/a b.ics'), '');
console.log('PASS ics: ' + ev.length + ' events, recurrence + EXDATE + time zone + link + url rules');
