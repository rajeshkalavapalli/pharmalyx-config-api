const Territoryservice = require('./territoryService')


exports.createTerritory = async(req,res)=>{
    try{
        const NewTerritory = req.body;
        console.log("territorydetails", NewTerritory)
        const AddNewTerritory = await Territoryservice.createTerriTory(NewTerritory)
        res.status(200).json({
            Territory:AddNewTerritory
        })

    }catch(err){
        console.log("error in creating territory", err)
    }
}


exports.getTerritorie = async (req, res) => {

    try {

        const { StateId } = req.params;

        const territories =
            await Territoryservice.getTerritorie(
                StateId
            );

        console.log(
            "territories:",
            territories
        );

        res.status(200).json({
            territories: territories
        });

    } catch (err) {

        console.log(
            "error getting territories",
            err
        );

        res.status(500).json({
            message: "Error getting territories"
        });

    }

};

exports.getTerritories = async (req, res)=>{
    try{
        const territories = await Territoryservice.getTerritories();
        res.status(200).json({
            
            territories:territories
        })

        console.log("listterrir ", territories)

    }catch(err){
            console.log("error fetching territores",err)
    }
}

exports.updateTerritory = async (req, res) => {
    try {
        const { TerritoryId } = req.params;
        const updatedData = req.body;
        const updatedTerritory = await Territoryservice.updateTerritory(TerritoryId, updatedData);
        res.status(200).json({
            Territory: updatedTerritory
        });
    } catch (err) {
        console.log("error updating territory", err);
        res.status(500).json({
            message: "Error updating territory"
        });
    }
};

exports.deleteTerritory = async (req, res) => {
    console.log("REQQQQQ", req)
    try {
        const { TerritoryId } = req.params;
        const deletedTerritory = await Territoryservice.deleteTerritory(TerritoryId);
        res.status(200).json({
            Territory: deletedTerritory
        });
    } catch (err) {
        console.log("error deleting territory", err);
        res.status(500).json({
            message: "Error deleting territory"
        });
    }
};

exports.getTerritoryById = async (req, res) => {
    try {
        const { TerritoryId } = req.params;
        const territory = await Territoryservice.getTerritoryById(TerritoryId);
        res.status(200).json({
            Territory: territory
        });
    } catch (err) {
        console.log("error fetching territory by id", err);
        res.status(500).json({
            message: "Error fetching territory by id"
        });
    }
};
