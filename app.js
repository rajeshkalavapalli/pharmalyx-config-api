const express = require("express")
const app = express()
const cors = require("cors");

const userRoutes = require('./controllers/Users')

const { poolPromise } = require('./db');

app.use(express.json());
app.use(cors());

app.use('/app', userRoutes)




app.listen(5000, ()=>{
    console.log("Pharmalyx Config API running on port 5000")
})