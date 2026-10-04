const express = require("express")
const app = express()
const cors = require("cors");

const userRoutes = require('./controllers/Users')

const divisionRoutes = require('./controllers/Division')

const countryRoutes = require('./controllers/MasterData/Country')

const territoryRoutes = require('./controllers/Territory')

const areaRoutes = require('./controllers/Areas')

const userAreaMaping = require('./controllers/UserAreaMapping')

const doctorRoutes = require('./controllers/Doctors')

const userDoctorMapping = require('./controllers/UserDoctorMapping')

const Pharmacy = require('./controllers/Pharmacy')

const StockistRoutes = require('./controllers/Stockist');

const userStockistMapping = require('./controllers/UserStockistMapping');

const userPharmacyMapping = require('./controllers/UserPharmacyMapping');

const { poolPromise } = require('./db');

app.use(express.json());
app.use(cors());

app.use('/app', userRoutes)
app.use('/app',divisionRoutes)
app.use('/app',countryRoutes)
app.use('/app',territoryRoutes)
app.use('/app',areaRoutes)
app.use('/app', userAreaMaping)
app.use('/app', doctorRoutes)
app.use('/app', userDoctorMapping)
app.use('/app', Pharmacy)
app.use('/app', StockistRoutes)
app.use('/app', userStockistMapping)
app.use('/app', userPharmacyMapping)




app.listen(5000, ()=>{
    console.log("Pharmalyx Config API running on port 5000")
})