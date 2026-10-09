// Supabase Edge Function: create-staff-account
//
// Called from TeamRolesManager when an admin creates a tailor or admin account from
// the dashboard. This runs server-side because creating a Supabase auth user requires
// the service-role key, which must never be shipped to the browser.
//
// There is no self-service signup in this app (see AuthScreen — sign-in only). Client
// records do not have login accounts; staff accounts come from here, and only an
// existing admin may call this.
//
// On success it:
//   1. Creates a new auth user with a randomly generated temporary password and the
//      given role in user_metadata (the on_auth_user_created trigger reads that into
//      profiles.role — see supabase/migrations/01_schema.sql).
//   2. Returns the temporary password once, so the admin can hand it to the new staff
//      member directly (in person / by phone). They sign in via the normal email/
//      password tab and can change it any time — there is no email dependency here.
//
// Deploy: supabase functions deploy create-staff-account

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Temporary staff passwords use cryptographically random values.
const PASSWORD_ALPHABET =
  'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function generateTempPassword(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let password = '';
  for (const b of bytes) {
    password += PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length];
  }
  return password;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Normalize optional staff phones to international Ghanaian format.
function sanitizeGhanaianPhoneNumber(phoneNumber: string): string {
  let digits = phoneNumber.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length === 10) {
    digits = '233' + digits.substring(1);
  } else if (digits.startsWith('233') && digits.length === 12) {
    // already correct
  } else if (digits.length === 9) {
    digits = '233' + digits;
  }
  if (digits.length !== 12 || !digits.startsWith('233')) {
    throw new Error(`Invalid Ghana phone number: '${phoneNumber}'. Expected 10 digits (e.g. 024XXXXXXX) or 233XXXXXXXXX.`);
  }
  return digits;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization') || '';

    // Verify the caller is a signed-in admin — this function creates accounts with
    // elevated (tailor/admin) roles, so it must not be callable by anyone else.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData?.user) {
      return new Response(JSON.stringify({ error: 'Not signed in.' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerData.user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can create staff accounts.' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const fullName: string = (body?.fullName || '').trim();
    const email: string = (body?.email || '').trim().toLowerCase();
    const role: string = body?.role || '';
    const phone: string | undefined = body?.phone ? String(body.phone).trim() : undefined;

    if (!fullName || !email) {
      return new Response(JSON.stringify({ error: 'fullName and email are required.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ error: 'Enter a valid email address.' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    // Only an existing admin can create staff accounts.
    if (role !== 'tailor' && role !== 'admin') {
      return new Response(JSON.stringify({ error: 'role must be "tailor" or "admin".' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    let sanitizedPhone: string | undefined;
    if (phone) {
      try {
        sanitizedPhone = sanitizeGhanaianPhoneNumber(phone);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid phone number.';
        return new Response(JSON.stringify({ error: message }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
    }

    const tempPassword = generateTempPassword();

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      phone: sanitizedPhone,
      email_confirm: true,
      phone_confirm: sanitizedPhone ? true : undefined,
      user_metadata: { full_name: fullName },
      app_metadata: { role },
    });

    if (createError || !created?.user) {
      const message = createError?.message?.toLowerCase().includes('already')
        ? 'An account with this email already exists.'
        : createError?.message || 'Failed to create staff account.';
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ userId: created.user.id, tempPassword }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[create-staff-account] Unhandled error:', err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
