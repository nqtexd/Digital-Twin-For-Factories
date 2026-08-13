import unittest

from app.config import Settings
from app.db import SupabaseRepository


class CompanyMemoryTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.repo = SupabaseRepository(Settings(supabase_url='', supabase_service_role_key='', groq_api_key=''))

    async def test_conversation_messages_are_retained(self):
        conversation = await self.repo.create_brain_conversation('Shift handover', 'LATHE-001')
        await self.repo.store_brain_message('user', 'Remember the bearing inspection.', 'LATHE-001', {}, conversation['id'])
        await self.repo.store_brain_message('assistant', 'Bearing inspection recorded.', 'LATHE-001', {}, conversation['id'])

        messages = await self.repo.list_brain_messages(conversation['id'])
        self.assertEqual([message['role'] for message in messages], ['user', 'assistant'])
        self.assertEqual((await self.repo.list_brain_conversations())[0]['id'], conversation['id'])

    async def test_retrieval_prefers_relevant_machine_memory(self):
        await self.repo.add_knowledge_document(
            'Lathe bearing inspection',
            'Inspect bearing vibration and lubrication when RMS velocity exceeds the approved limit.',
            'LATHE-001',
        )
        await self.repo.add_knowledge_document('Coolant ordering', 'Order coolant drums every second Friday.', 'PUMP-005')

        sources = await self.repo.search_company_memory('bearing vibration inspection limit', 'LATHE-001')
        self.assertTrue(sources)
        self.assertEqual(sources[0]['title'], 'Lathe bearing inspection')
        self.assertGreater(sources[0]['score'], 0.5)


if __name__ == '__main__':
    unittest.main()
