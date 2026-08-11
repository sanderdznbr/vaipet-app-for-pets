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
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #31D880; margin: 0;">VaiPet</h1>
          </div>
          <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Bem-vindo ao VaiPet!</h2>
          <p style="font-size: 16px; line-height: 24px; color: #666;">Para concluir seu cadastro, use o código de verificação abaixo:</p>
          <div style="background: #F2F2F7; padding: 32px; text-align: center; border-radius: 16px; margin: 24px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #000; font-family: monospace;">${otp}</span>
          </div>
          <p style="font-size: 14px; color: #999; text-align: center;">Este código expira em breve.</p>
          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #EEE; font-size: 12px; color: #AAA; text-align: center;">
            Se você não solicitou este e-mail, por favor ignore-o.
          </div>
        </div>
      `;
    } else if (event === 'recovery') {
      subject = "Recuperação de Senha - VaiPet";
      html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #31D880; margin: 0;">VaiPet</h1>
          </div>
          <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 16px;">Recuperação de Senha</h2>
          <p style="font-size: 16px; line-height: 24px; color: #666;">Recebemos uma solicitação para redefinir sua senha.</p>
          <div style="background: #F2F2F7; padding: 32px; text-align: center; border-radius: 16px; margin: 24px 0;">
             <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #000; font-family: monospace;">${otp}</span>
          </div>
          <p style="font-size: 16px; line-height: 24px; color: #666;">Insira este código no aplicativo para prosseguir.</p>
          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #EEE; font-size: 12px; color: #AAA; text-align: center;">
            Se você não solicitou a troca de senha, sua conta está segura.
          </div>
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
