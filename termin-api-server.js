const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// --- CONFIG ---
const PIPEDRIVE_API_TOKEN = process.env.PIPEDRIVE_API_TOKEN || 'DEIN_API_TOKEN_HIER';
const PIPEDRIVE_BASE = 'https://api.pipedrive.com/v1';

// Optional: Stage-ID für neue Termin-Deals (findest du in Pipedrive unter Pipeline-Einstellungen)
const DEAL_STAGE_ID = process.env.DEAL_STAGE_ID || null;

// Erlaubte Origins
const ALLOWED_ORIGINS = [
    'https://termin.elevo.solutions',
    'https://elevo.solutions',
    'http://localhost:3000',
    'http://localhost:5500'
];

// --- MIDDLEWARE ---
app.use(cors({
    origin: (origin, cb) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        cb(new Error('Not allowed'));
    }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- PIPEDRIVE HELPER ---
async function pipedrive(endpoint, data) {
    const url = `${PIPEDRIVE_BASE}${endpoint}?api_token=${PIPEDRIVE_API_TOKEN}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const json = await res.json();
    if (!json.success) {
        console.error(`Pipedrive Error [${endpoint}]:`, json);
        throw new Error(json.error || 'Pipedrive API error');
    }
    return json.data;
}

// --- MAIN ENDPOINT ---
app.post('/termin', async (req, res) => {
    try {
        const { vorname, nachname, email, unternehmen, preferred_time } = req.body;

        // Validierung
        if (!vorname || !nachname || !email) {
            return res.status(400).json({ success: false, error: 'Vorname, Nachname und E-Mail sind Pflicht.' });
        }

        const fullName = `${vorname} ${nachname}`;
        console.log(`\n[TERMIN] Neue Anfrage: ${fullName} (${email})`);

        // 1. Person in Pipedrive anlegen
        const personData = {
            name: fullName,
            email: [{ value: email, primary: true, label: 'work' }]
        };
        if (unternehmen) {
            personData.org_id = null; // Org wird über Deal-Titel abgebildet
        }

        const person = await pipedrive('/persons', personData);
        console.log(`[TERMIN] Person erstellt: ID ${person.id}`);

        // 2. Deal erstellen
        const dealTitle = unternehmen
            ? `Termin: ${fullName} (${unternehmen})`
            : `Termin: ${fullName}`;

        const dealData = {
            title: dealTitle,
            person_id: person.id
        };
        if (DEAL_STAGE_ID) {
            dealData.stage_id = parseInt(DEAL_STAGE_ID);
        }

        const deal = await pipedrive('/deals', dealData);
        console.log(`[TERMIN] Deal erstellt: ID ${deal.id}`);

        // 3. Aktivität (Rückruf-Reminder) erstellen
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dueDate = tomorrow.toISOString().split('T')[0];

        const timeNote = preferred_time || 'Keine Präferenz';

        const activity = await pipedrive('/activities', {
            subject: `Rückruf: ${fullName} — ${timeNote}`,
            type: 'call',
            due_date: dueDate,
            due_time: '18:00',
            person_id: person.id,
            deal_id: deal.id,
            note: `Terminanfrage über termin.elevo.solutions\n\nName: ${fullName}\nE-Mail: ${email}\nUnternehmen: ${unternehmen || '—'}\nBevorzugte Zeit: ${timeNote}\n\nEingegangen: ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`
        });
        console.log(`[TERMIN] Aktivität erstellt: ID ${activity.id}`);

        // 4. Notiz zum Deal hinzufügen
        await pipedrive('/notes', {
            content: `<b>Terminanfrage (termin.elevo.solutions)</b><br><br>Bevorzugte Zeit: <b>${timeNote}</b><br>Unternehmen: ${unternehmen || '—'}<br>Eingegangen: ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`,
            deal_id: deal.id,
            pinned_to_deal_flag: 1
        });

        console.log(`[TERMIN] ✅ Komplett: ${fullName} → Person ${person.id}, Deal ${deal.id}, Activity ${activity.id}\n`);

        res.json({ success: true });

    } catch (err) {
        console.error('[TERMIN] ❌ Fehler:', err.message);
        res.status(500).json({ success: false, error: 'Interner Fehler. Bitte versuche es erneut.' });
    }
});

// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'elevo-termin-api' });
});

// --- START ---
app.listen(PORT, () => {
    console.log(`\n🚀 ELEVO Termin-API läuft auf Port ${PORT}`);
    console.log(`   POST /termin  → Pipedrive Lead erstellen`);
    console.log(`   GET  /health  → Health Check\n`);
});
