const https = require('https');

const token = process.env.TOKEN;

function sendTemplate(to) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "template",
      template: {
        name: "etapalwala_template",
        language: { code: "en_US" },
        components: [{
          type: "header",
          parameters: [{
            type: "document",
            document: {
              link: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
              filename: "Test_Notice.pdf"
            }
          }]
        }]
      }
    });

    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: '/v19.0/958509977341237/messages',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        console.log(`\n=== Sending to ${to} ===`);
        console.log('HTTP Status:', res.statusCode);
        try {
          const parsed = JSON.parse(data);
          console.log('Full Response:', JSON.stringify(parsed, null, 2));
          if (parsed.error) {
            console.log('ERROR CODE:', parsed.error.code);
            console.log('ERROR MSG:', parsed.error.message);
            if (parsed.error.error_data) {
              console.log('ERROR DATA:', JSON.stringify(parsed.error.error_data));
            }
          } else {
            console.log('MESSAGE ID:', parsed.messages?.[0]?.id);
            console.log('STATUS:', parsed.messages?.[0]?.message_status);
          }
        } catch(e) {
          console.log('RAW:', data);
        }
        resolve();
      });
    });

    req.on('error', e => { console.error('Error:', e.message); reject(e); });
    req.write(payload);
    req.end();
  });
}

async function checkPhoneNumberStatus() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: '/v19.0/958509977341237?fields=display_phone_number,verified_name,code_verification_status,account_mode,quality_rating,throughput,last_onboarded_time',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        console.log('\n=== PHONE NUMBER STATUS ===');
        const parsed = JSON.parse(data);
        console.log(JSON.stringify(parsed, null, 2));
        resolve(parsed);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  await checkPhoneNumberStatus();
  
  console.log('\n=== Testing send to +917028654498 ===');
  await sendTemplate('917028654498');
})().catch(console.error);
