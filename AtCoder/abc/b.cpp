#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll t;
	cin >> t;
	while (t--) {
		vector<ll> a;
		ll sum = 0;
		for (ll i = 0; i < 3; i++) {
			ll x; cin >> x;
			sum += x;
			a.push_back(x);
		}
		ll index = 0;
		for (int i = 0; i < 3; i++) {
			if (a[i] > a[index]) {
				index = i;
			}
		}
		if (index == 0) {
			for (ll i = 0; i < sum; i++) {
				cout << "P";
			}
			cout << endl;
		} else if (index == 1) {
			for (ll i = 0; i < sum; i++) {
				cout << "R";
			}
			cout << endl;
		} else if (index == 2) {
			for (ll i = 0; i < sum; i++) {
				cout << "S";
			}
			cout << endl;
		}
	}
	return 0;
}

int main() {
	solve();
	return 0;
}
