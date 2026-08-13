import unittest

from app.config import Settings
from app.db import SupabaseRepository
from app.risk_engine import HybridRiskEngine
from app.simulator import MACHINE_TYPE_CATALOG, PlantSimulator


class DynamicFactoryTest(unittest.IsolatedAsyncioTestCase):
    async def test_catalog_machine_is_added_to_shared_factory_model(self):
        simulator = PlantSimulator(
            SupabaseRepository(Settings(supabase_url='', supabase_service_role_key='', groq_api_key='')),
            HybridRiskEngine(seed=7),
        )
        created = await simulator.add_machine('LATHE-099', 'cnc_lathe', 'Prototype Lathe', 'Machining · A', 72, 42)

        self.assertIn('cnc_lathe', MACHINE_TYPE_CATALOG)
        self.assertIn('LATHE-099', simulator.states)
        self.assertEqual(created['machine']['metadata']['layout_x'], 72)
        self.assertEqual(created['machine']['metadata']['description'], MACHINE_TYPE_CATALOG['cnc_lathe']['description'])
        self.assertIsNotNone(created['telemetry'])


if __name__ == '__main__':
    unittest.main()
