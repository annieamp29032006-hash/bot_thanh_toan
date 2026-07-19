const axios = require('axios');
const token = '8809BBA3-D7FF-E6A5-AB0C-B0CF6CC8CA89';

const endpoints = [
    `https://api.web2m.com/historyapimbbank/${token}`,
    `https://api.web2m.com/historyapimb/${token}`,
    `https://api.web2m.com/historyapitransaction/${token}`,
    `https://api.web2m.com/historyapivcb/${token}`
];

async function test() {
    for (const url of endpoints) {
        try {
            const res = await axios.get(url, { timeout: 5000 });
            console.log(`[OK] ${url} -> Status: ${res.status}`);
            console.log(res.data);
            break;
        } catch (e) {
            console.log(`[FAIL] ${url} -> ${e.message}`);
        }
    }
}
test();
