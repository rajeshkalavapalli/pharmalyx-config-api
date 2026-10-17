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

const TourPlan = require('./controllers/TourPlan');

const DeviationTourPlan = require('./controllers/DeviationTourPlan');

const MyDoctors = require('./controllers/MyDoctors');

const Visits = require('./controllers/Visits');

const Dcr = require('./controllers/Dcr');

const Configuration = require('./controllers/Configuration');

const Dashboard = require('./controllers/Dashboard');

const Catalogue = require('./controllers/Catalogue');

const Stock = require('./controllers/Stock');

const Rcpa = require('./controllers/Rcpa');

const DoctorBusiness = require('./controllers/DoctorBusiness');

const Feedback = require('./controllers/Feedback');

const Roles = require('./controllers/Roles');

const PreCall = require('./controllers/PreCall');

const Orders = require('./controllers/Orders');

const SalesAccounts = require('./controllers/SalesAccounts');

const SecondarySales = require('./controllers/SecondarySales');

const SalesBusiness = require('./controllers/SalesBusiness');

const SalesPlan = require('./controllers/SalesPlan');

const DoctorPlan = require('./controllers/DoctorPlan');

const Expenses = require('./controllers/Expenses');

const Reports = require('./controllers/Reports');

const Insights = require('./controllers/Insights');

const Approvals = require('./controllers/Approvals');

const HR = require('./controllers/HR');

const DoctorRequests = require('./controllers/DoctorRequests');

const DoctorVerification = require('./controllers/DoctorVerification');

const { poolPromise } = require('./db');
const { authenticate } = require('./utils/auth');

app.use(express.json());
app.use(cors());

// Every /app route requires a verified session except POST /app/login.
app.use('/app', authenticate);

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
app.use('/app', TourPlan)
app.use('/app', DeviationTourPlan)
app.use('/app', MyDoctors)
app.use('/app', Visits)
app.use('/app', Dcr)
app.use('/app', Configuration)
app.use('/app', Dashboard)
app.use('/app', Catalogue)
app.use('/app', Stock)
app.use('/app', Rcpa)
app.use('/app', DoctorBusiness)
app.use('/app', Feedback)
app.use('/app', Roles)
app.use('/app', PreCall)
app.use('/app', Orders)
app.use('/app', SalesAccounts)
app.use('/app', SecondarySales)
app.use('/app', SalesBusiness)
app.use('/app', SalesPlan)
app.use('/app', DoctorPlan)
app.use('/app', Expenses)
app.use('/app', Reports)
app.use('/app', Insights)
app.use('/app', Approvals)
app.use('/app', HR)
app.use('/app', DoctorRequests)
app.use('/app', DoctorVerification)




app.listen(5000, ()=>{
    console.log("Pharmalyx Config API running on port 5000")
})