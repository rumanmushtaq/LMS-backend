const mongoose = require('mongoose');

mongoose.connect('mongodb://localhost:27017/varona-academy', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const materials = mongoose.connection.collection('tutormaterials');
    const count = await materials.countDocuments({});
    console.log("Total Materials:", count);
    
    const docs = await materials.find({}).toArray();
    console.log("MATERIALS:", JSON.stringify(docs, null, 2));
    process.exit(0);
  }).catch(e => {
    console.error("DB Error:", e);
    process.exit(1);
  });
