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

