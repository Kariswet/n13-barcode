from model import Param, MetadataResponse, Metadata
from config import ConectionManager

class ProductService:
    def __init__(self):
        self.conn = ConectionManager()

    def get_one_product(self, param: Param):
        coll = self.conn.get_collection('product')
        
        if not coll:
            return MetadataResponse(
                data = "",
                metadata = Metadata(
                    message = "failed",
                    status = False
                )
            )
        else:
            data = coll.find_one({'_id': param.get('_id')})
    
        return MetadataResponse(
            data = data,
            metadata = Metadata(
                message = "success",
                status = True
            )
        )