const axios = require('axios');
async function test() {
  try {
    const res = await axios.get('http://localhost:3000/api/v1/tutor-materials');
    console.log("ALL:", JSON.stringify(res.data, null, 2));
  } catch (e) { console.error(e.response?.data || e.message); }
}
test();
