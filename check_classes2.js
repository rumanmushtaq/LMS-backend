const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://rumanmdev_db_user:S65uKGqzPQDNhYNl@cluster0.yhbeei2.mongodb.net/test')
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
