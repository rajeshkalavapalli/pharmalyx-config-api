const express = require("express")
const app = express()
const cors = require("cors");

const userRoutes = require('./controllers/Users')

const divisionRoutes = require('./controllers/Division')

const countryRoutes = require('./controllers/MasterData/Country')

const territoryRoutes = require('./controllers/Territory')

const areaRoutes = require('./controllers/Areas')

const { poolPromise } = require('./db');

app.use(express.json());
app.use(cors());

app.use('/app', userRoutes)
app.use('/app',divisionRoutes)
app.use('/app',countryRoutes)
app.use('/app',territoryRoutes)
app.use('/app',areaRoutes)




app.listen(5000, ()=>{
    console.log("Pharmalyx Config API running on port 5000")
})