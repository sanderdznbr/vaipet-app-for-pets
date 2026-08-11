import { serve } from "https://deno.land/std@0.190.0/http/server.ts"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json();
    const { event, email, otp } = payload;
    
    if (!email) {
      return new Response(JSON.stringify({ message: "No email provided" }), { status: 200 });
    }

    console.log(`Auth Hook Triggered: Event=${event}, Email=${email}`);

    let subject = "VaiPet";
    let html = "";

    if (event === 'signup' || event === 'resend_otp') {
      subject = "Seu código de verificação VaiPet";
      html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #31D880;">Bem-vindo ao VaiPet!</h2>
          <p>Para concluir seu cadastro, use o código de verificação abaixo:</p>
          <div style="background: #F2F2F7; padding: 20px; text-align: center; border-radius: 12px; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #000;">${otp}</span>
          </div>
          <p>Este código expira em breve.</p>
          <hr style="border: none; border-top: 1px solid #EEE; margin: 20px 0;" />
          <p style="font-size: 12px; color: #666;">Se você não solicitou este e-mail, por favor ignore-o.</p>
        </div>
      `;
    } else if (event === 'recovery') {
      subject = "Recuperação de Senha - VaiPet";
      html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #31D880;">Recuperação de Senha</h2>
          <p>Recebemos uma solicitação para redefinir sua senha.</p>
          <div style="background: #F2F2F7; padding: 20px; text-align: center; border-radius: 12px; margin: 20px 0;">
             <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #000;">${otp}</span>
          </div>
          <p>Insira este código no aplicativo para prosseguir.</p>
          <hr style="border: none; border-top: 1px solid #EEE; margin: 20px 0;" />
          <p style="font-size: 12px; color: #666;">Se você não solicitou a troca de senha, sua conta está segura.</p>
        </div>
      `;
    } else {
      return new Response(JSON.stringify({ message: `Event ${event} not handled` }), { status: 200 });
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'VaiPet <noreply@vaipet.app>',
        to: [email],
        subject: subject,
        html: html,
      }),
    });

    const resData = await res.json();
    return new Response(JSON.stringify(resData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: res.status,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
})
