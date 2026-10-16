import type { Schema, Struct } from '@strapi/strapi';

export interface PaymentBankItem extends Struct.ComponentSchema {
  collectionName: 'components_payment_bank_items';
  info: {
    displayName: 'Bank Item';
  };
  attributes: {
    account_name: Schema.Attribute.String;
    account_number: Schema.Attribute.String;
    bank_code: Schema.Attribute.String;
    display_name: Schema.Attribute.String;
    logo: Schema.Attribute.Media<'images'>;
    qr_code: Schema.Attribute.Media<'images'>;
    reference_hint: Schema.Attribute.Text;
    reference_label: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'payment.bank-item': PaymentBankItem;
    }
  }
}
