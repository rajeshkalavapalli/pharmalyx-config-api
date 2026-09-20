const AreaDA = require('./AreaDA')

const { generateUUID } = require('../../utils/commonUtils');

const generateAreaCode = (AreaName, sequence) => {
    const prefix = AreaName
        .replace(/\s+/g, '')
        .substring(0, 3)
        .toUpperCase();

    return `${prefix}-${String(sequence).padStart(3, '0')}`;
};

exports.createArea = async (reqData) => {
    try{    
        const existingArea = await AreaDA.checkAreaExists(
            reqData.TerritoryId,
            reqData.AreaName.trim()
        );

        if (existingArea.length > 0) {
            const duplicateError = new Error("Area already exists for this territory");
            duplicateError.statusCode = 409;
            throw duplicateError;
        }

        let areaCode = reqData.AreaCode;
        if (!areaCode) {
            const sequenceResult = await AreaDA.getNextAreaSequence(
                reqData.TerritoryId
            );
            areaCode = generateAreaCode(
                reqData.AreaName.trim(),
                sequenceResult[0].NextSequence
            );
        }

        const areaId = generateUUID();
        const now = new Date();
        const newArea = {
            ...reqData,
            AreaName: reqData.AreaName.trim(),
            AreaCode: areaCode,
            AreaId: areaId,
            CreatedOn: now,
            ModifiedOn: now
        };
        const result = await AreaDA.createArea(newArea);
        return result;

    }catch(err){
        console.log("error creating area", err )
        throw err;
    }
}

exports.getAreasCode = async () => {
    try{    
        const result = await AreaDA.getAreasCode();
        return result;

    }catch(err){
        console.log("error in get area code", err)
    }   
}

exports.getNextAreaSequence = async (TerritoryId) => {
    try{
        const result = await AreaDA.getNextAreaSequence(TerritoryId);
        return result;  
    }catch(err){
        console.log("error in get next area sequence", err)
        throw err;
    }
}

exports.checkAreaExists = async (TerritoryId, AreaName) => {
    try{
        const result = await AreaDA.checkAreaExists(TerritoryId, AreaName); 
        return result;
    }catch(err){ 
        console.log("error in check area exists", err)
        throw err;
    }
}

exports.previewAreaCode = async (TerritoryId, AreaName) => {
    try {
        const existingArea = await AreaDA.checkAreaExists(
            TerritoryId,
            AreaName
        );

        if (existingArea.length > 0) {
            return {
                exists: true,
                areaCode: existingArea[0].AreaCode
            };
        }

        const sequenceResult =
            await AreaDA.getNextAreaSequence(TerritoryId);

        const sequence = sequenceResult[0].NextSequence;

        const areaCode = generateAreaCode(
            AreaName,
            sequence
        );

        return {
            exists: false,
            areaCode: areaCode
        };

    } catch (err) {
        console.log("error in preview area code", err);
        throw err;
    }
};