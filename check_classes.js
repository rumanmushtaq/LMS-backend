const mongoose = require('mongoose');
const { Types } = mongoose;

mongoose.connect('mongodb://localhost:27017/lms') // or whatever the DB URL is. Let's assume lms based on standard.
  .then(async () => {
    console.log("Connected to MongoDB.");
    const classes = mongoose.connection.collection('classsessions');
    const allClasses = await classes.find({}).toArray();
    console.log(`Found ${allClasses.length} classes:`);
    console.log(JSON.stringify(allClasses, null, 2));
    mongoose.disconnect();
  })
  .catch(err => {
    console.error(err);
    mongoose.disconnect();
  });
