from rest_framework import serializers
from decimal import Decimal
from datetime import timedelta

from django.utils import timezone

from .models import Quote, Customer



COST_PER_KM = Decimal('1.70')


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = ['name', 'address', 'distance_from_previous_km', 'order', 'coords_lat', 'coords_lng']
        read_only_fields = ['order']



class QuoteSerializer(serializers.ModelSerializer):
    customers = CustomerSerializer(many=True, read_only=True)

    class Meta:
        model = Quote
        fields = [
            'id', 'quote_number', 'tracking_number', 'depot_address', 'bakery_address', 'end_depot_address',
            'depot_to_bakery_km', 'bakery_to_first_customer_km',
            'margin_percent', 'total_distance_km', 'total_weight_kg', 'cogs', 'revenue',
            'created_at', 'pickup_coords_lat', 'pickup_coords_lng', 'customers'
        ]
        read_only_fields = ['id', 'created_at', 'customers']


class QuoteCreateSerializer(serializers.ModelSerializer):
    customers = CustomerSerializer(many=True)

    class Meta:
        model = Quote
        fields = [
            # identifiers / route
            'quote_number', 'tracking_number', 'depot_address', 'bakery_address', 'end_depot_address',
            'depot_to_bakery_km', 'bakery_to_first_customer_km',
            'margin_percent',
            'total_weight_kg',
            'pickup_coords_lat', 'pickup_coords_lng',
            # contact information
            'sender_name', 'sender_email', 'sender_phone',
            'recipient_name', 'recipient_email', 'recipient_phone',
            # special requests
            'liability_cover', 'early_collection', 'signature_on_delivery', 'wedding_venue', 'special_instructions', 'delivery_directions',

            # dates
            'quote_expiry_date',
            # parcels
            'parcels',
            # nested customers
            'customers'
        ]

    def create(self, validated_data):
        from .pricing import compute_price, get_default_rate_card

        customers_data = validated_data.pop('customers', [])

        if not validated_data.get('quote_expiry_date'):
            validated_data['quote_expiry_date'] = timezone.now() + timedelta(days=7)

        # Distances
        d1 = Decimal(str(validated_data.get('depot_to_bakery_km', '0') or '0'))
        d2 = Decimal(str(validated_data.get('bakery_to_first_customer_km', '0') or '0'))
        customer_distances = [
            Decimal(str(cust.get('distance_from_previous_km', '0') or '0'))
            for cust in customers_data
        ]
        total_distance = d1 + d2 + sum(customer_distances)

        # Rates are resolved server-side from the client link (see QuoteViewSet.create).
        # Any margin_percent sent by the browser is intentionally ignored.
        rate_card = self.context.get('rate_card') or get_default_rate_card()
        client_link = self.context.get('client_link')

        priced = compute_price(total_distance, rate_card)
        validated_data['margin_percent'] = Decimal(str(priced['margin_fraction'])).quantize(Decimal('0.01'))

        quote = Quote.objects.create(
            **validated_data,
            total_distance_km=Decimal(str(priced['distance_km'])),
            cogs=Decimal(str(priced['cogs'])),
            revenue=Decimal(str(priced['price'])),
            rate_card=rate_card,
            client_link=client_link,
        )

        for idx, customer_data in enumerate(customers_data):
            Customer.objects.create(
                quote=quote,
                order=idx + 1,
                **customer_data
            )
        return quote

